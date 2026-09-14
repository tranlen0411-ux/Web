import React, { useState, useEffect, useMemo } from 'react';
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
  KeyRound,
  FileSpreadsheet,
  UserCheck,
  RotateCcw,
  QrCode,
  Layers
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AddGameModal } from '../components/dashboard/AddGameModal';
import { EditGameModal } from '../components/dashboard/EditGameModal';
import { UserFormModal } from '../components/dashboard/UserFormModal';
import { UserDeleteModal } from '../components/dashboard/UserDeleteModal';
import { StudentPinModal } from '../components/dashboard/StudentPinModal';
import { StudentQrModal } from '../components/dashboard/StudentQrModal';
import { ImportStudentsModal } from '../components/dashboard/ImportStudentsModal';
import { AssignTeacherModal } from '../components/dashboard/AssignTeacherModal';
import { ResetScoresModal } from '../components/dashboard/ResetScoresModal';
import { ParentCodeCell } from '../components/common/ParentCodeCell';
import { useSound } from '../context/SoundContext';
import { ExerciseListTab } from '../components/dashboard/exercises/ExerciseListTab';
import { QuestionBankListTab } from '../components/dashboard/question-bank/QuestionBankListTab';
import { ExamManagementTab } from '../components/dashboard/exams/ExamManagementTab';

export const AdminDashboard = () => {
  const { profile, globalClassFilter, setGlobalClassFilter } = useAuth();
  const { triggerSound } = useSound();
  const [searchParams] = useSearchParams();

  // Xác định tab chủ đạo dựa vào URL param ?tab=games hoặc ?tab=users hoặc ?tab=exams hoặc ?tab=academic-assignments
  const tabParam = searchParams.get('tab');
  const [activeAdminTab, setActiveAdminTab] = useState(
    tabParam === 'exams'
      ? 'exams'
      : tabParam === 'question-bank'
      ? 'question-bank'
      : (tabParam === 'exercises' || tabParam === 'academic-assignments')
      ? 'academic-assignments'
      : tabParam === 'games'
      ? 'games'
      : 'users'
  );

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'games' || tab === 'users' || tab === 'exercises' || tab === 'academic-assignments' || tab === 'question-bank' || tab === 'exams') {
      setActiveAdminTab(tab === 'exercises' ? 'academic-assignments' : tab);
    }
  }, [searchParams]);

  const [stats, setStats] = useState({ users: 0, games: 0, classes: 0 });
  const [usersList, setUsersList] = useState([]);
  const [usersDataReady, setUsersDataReady] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [gamesList, setGamesList] = useState([]);
  const [classesListState, setClassesListState] = useState([]);
  const [classesError, setClassesError] = useState(false);
  const [classMembersList, setClassMembersList] = useState([]);
  const [classMembersError, setClassMembersError] = useState(false);
  const [classFilterDataReady, setClassFilterDataReady] = useState(false);
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Trạng thái PIN học sinh (cache boolean true/false theo student.id)
  const [pinStatusMap, setPinStatusMap] = useState({});
  const [userForPin, setUserForPin] = useState(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Trạng thái Quản lý QR học sinh
  const [userForQr, setUserForQr] = useState(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  // Modals state
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [isEditGameOpen, setIsEditGameOpen] = useState(false);
  const [gameToEdit, setGameToEdit] = useState(null);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [isImportStudentsOpen, setIsImportStudentsOpen] = useState(false);
  const [isAssignTeacherOpen, setIsAssignTeacherOpen] = useState(false);
  const [isResetScoresOpen, setIsResetScoresOpen] = useState(false);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    setUsersDataReady(false);
    setClassFilterDataReady(false);
    setUsersError(false);
    setClassesError(false);
    setClassMembersError(false);

    try {
      // 1. Thống kê tổng số
      const { count: uCount } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
      const { count: gCount } = await supabase.from('games').select('id', { count: 'exact', head: true });
      const { count: cCount, data: cData, error: cErr } = await supabase.from('classes').select('*', { count: 'exact' }).order('grade_level');

      if (cErr) {
        console.error('Fetch classes error:', cErr.message || cErr);
        setClassesError(true);
        setClassesListState([]);
      } else {
        setClassesError(false);
        setClassesListState(cData || []);
      }

      setStats({ users: uCount || 0, games: gCount || 0, classes: cCount || 0 });

      // 2. Lấy danh sách thành viên lớp (class_members) cho cột Lớp
      const { data: cmData, error: cmErr } = await supabase
        .from('class_members')
        .select('student_id, class_id');

      if (cmErr) {
        console.error('Fetch class_members error:', cmErr.message || cmErr);
        setClassMembersError(true);
        setClassMembersList([]);
      } else {
        setClassMembersError(false);
        setClassMembersList(cmData || []);
      }

      // Đánh dấu cả hai truy vấn classes và class_members đã hoàn tất (settled)
      setClassFilterDataReady(true);
    } catch (err) {
      console.error('Fetch classes/class_members error:', err);
      setClassesError(true);
      setClassMembersError(true);
      setClassFilterDataReady(true);
    }

    let sortedUsers = [];
    try {
      // 3. Lấy danh sách người dùng
      const { data: uData, error: uErr } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (uErr) {
        console.error('Fetch profiles error:', uErr.message || uErr);
        setUsersError(true);
        setUsersList([]);
      } else {
        setUsersError(false);
        sortedUsers = uData || [];
        setUsersList(sortedUsers);
      }
      setUsersDataReady(true);
    } catch (err) {
      console.error('Fetch profiles error:', err);
      setUsersError(true);
      setUsersList([]);
      setUsersDataReady(true);
    }

    try {
      // Kiểm tra trạng thái PIN học sinh qua RPC has_student_pin (không ảnh hưởng readiness bảng người dùng)
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

      // 4. Lấy danh sách trò chơi
      const { data: gData } = await supabase
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });

      setGamesList(gData || []);
    } catch (err) {
      console.error('Fetch games/pin error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Dựng Map tra cứu lớp học cho Học sinh, Giáo viên và tính toán danh sách lọc theo globalClassFilter
  const {
    studentClassesById,
    teacherClassesById,
    classFilteredUsers,
    filterStateStatus,
    filterNote
  } = useMemo(() => {
    const classById = new Map();
    (classesListState || []).forEach(c => {
      if (c && c.id) {
        classById.set(c.id, c);
      }
    });

    const sortClasses = (arr) => {
      return [...arr].sort((a, b) => {
        if ((a.grade_level || 0) !== (b.grade_level || 0)) {
          return (a.grade_level || 0) - (b.grade_level || 0);
        }
        return (a.name || '').localeCompare(b.name || '', 'vi');
      });
    };

    // Map student_id -> danh sách lớp (loại bỏ trùng lặp theo class.id)
    const studentMap = new Map();
    (classMembersList || []).forEach(cm => {
      if (!cm || !cm.student_id || !cm.class_id) return;
      const cls = classById.get(cm.class_id);
      if (!cls) return; // Bỏ qua nếu class không tồn tại trong danh sách lớp (orphan)
      if (!studentMap.has(cm.student_id)) {
        studentMap.set(cm.student_id, new Map());
      }
      studentMap.get(cm.student_id).set(cls.id, cls);
    });

    const studentClassesById = new Map();
    studentMap.forEach((classesMap, studentId) => {
      studentClassesById.set(studentId, sortClasses(Array.from(classesMap.values())));
    });

    // Map teacher_id -> danh sách lớp phụ trách (loại bỏ trùng lặp theo class.id)
    const teacherMap = new Map();
    (classesListState || []).forEach(cls => {
      if (!cls || !cls.teacher_id) return;
      if (!teacherMap.has(cls.teacher_id)) {
        teacherMap.set(cls.teacher_id, new Map());
      }
      teacherMap.get(cls.teacher_id).set(cls.id, cls);
    });

    const teacherClassesById = new Map();
    teacherMap.forEach((classesMap, teacherId) => {
      teacherClassesById.set(teacherId, sortClasses(Array.from(classesMap.values())));
    });

    // Tính toán danh sách người dùng theo phạm vi lớp (classFilteredUsers)
    // 1. ALL: Hiển thị toàn bộ Admin, Giáo viên, Học sinh (không phụ thuộc classFilterDataReady)
    if (!globalClassFilter || globalClassFilter === 'ALL') {
      if (!usersDataReady) {
        return {
          studentClassesById,
          teacherClassesById,
          classFilteredUsers: [],
          filterStateStatus: 'LOADING',
          filterNote: null
        };
      }
      if (usersError) {
        return {
          studentClassesById,
          teacherClassesById,
          classFilteredUsers: [],
          filterStateStatus: 'USER_ERROR',
          filterNote: 'Không tải được danh sách người dùng'
        };
      }
      return {
        studentClassesById,
        teacherClassesById,
        classFilteredUsers: usersList || [],
        filterStateStatus: 'OK',
        filterNote: null
      };
    }

    // 2. Bộ lọc UUID hoặc NO_CLASS: Cần cả usersDataReady và classFilterDataReady
    if (!usersDataReady || !classFilterDataReady) {
      return {
        studentClassesById,
        teacherClassesById,
        classFilteredUsers: [],
        filterStateStatus: 'LOADING',
        filterNote: null
      };
    }

    // 3. Lỗi người dùng sau khi settled
    if (usersError) {
      return {
        studentClassesById,
        teacherClassesById,
        classFilteredUsers: [],
        filterStateStatus: 'USER_ERROR',
        filterNote: 'Không tải được danh sách người dùng'
      };
    }

    // 4. Lỗi classes hoặc class_members sau khi đã settled
    if (classesError || classMembersError) {
      return {
        studentClassesById,
        teacherClassesById,
        classFilteredUsers: [],
        filterStateStatus: 'ERROR',
        filterNote: 'Không tải được dữ liệu để lọc theo lớp'
      };
    }

    // 5. NO_CLASS: Người dùng chưa được xếp/phân công lớp
    if (globalClassFilter === 'NO_CLASS') {
      const filtered = (usersList || []).filter(u => {
        if (!u) return false;
        if (u.role === 'admin') return false;
        if (u.role === 'teacher') {
          const tClasses = teacherClassesById.get(u.id) || [];
          return tClasses.length === 0;
        }
        if (u.role === 'student') {
          const sClasses = studentClassesById.get(u.id) || [];
          return sClasses.length === 0;
        }
        return false;
      });

      return {
        studentClassesById,
        teacherClassesById,
        classFilteredUsers: filtered,
        filterStateStatus: 'OK',
        filterNote: 'Người dùng chưa được xếp/phân công lớp'
      };
    }

    // 6. UUID lớp cụ thể (chỉ kiểm tra INVALID_CLASS sau khi đã ready và không có lỗi)
    const selectedCls = classById.get(globalClassFilter);
    if (!selectedCls) {
      return {
        studentClassesById,
        teacherClassesById,
        classFilteredUsers: [],
        filterStateStatus: 'INVALID_CLASS',
        filterNote: 'Lớp đã chọn không tồn tại hoặc không còn khả dụng'
      };
    }

    const targetStudentIds = new Set();
    (classMembersList || []).forEach(cm => {
      if (cm && cm.class_id === selectedCls.id && cm.student_id) {
        targetStudentIds.add(cm.student_id);
      }
    });

    const targetTeacherId = selectedCls.teacher_id || null;

    const filtered = (usersList || []).filter(u => {
      if (!u) return false;
      if (u.role === 'admin') return false;
      if (u.role === 'teacher') {
        return targetTeacherId && u.id === targetTeacherId;
      }
      if (u.role === 'student') {
        return targetStudentIds.has(u.id);
      }
      return false;
    });

    return {
      studentClassesById,
      teacherClassesById,
      classFilteredUsers: filtered,
      filterStateStatus: 'OK',
      filterNote: null
    };
  }, [
    classesListState,
    classMembersList,
    usersList,
    globalClassFilter,
    classesError,
    classMembersError,
    classFilterDataReady,
    usersDataReady,
    usersError
  ]);

  // Thống kê số lượng người dùng theo từng vai trò dựa trên danh sách theo phạm vi lớp (classFilteredUsers)
  const userRoleCounts = useMemo(() => {
    if (filterStateStatus === 'LOADING') {
      return { all: '…', students: '…', teachers: '…', admins: '…', total: '…' };
    }
    if (filterStateStatus !== 'OK') {
      return { all: '—', students: '—', teachers: '—', admins: '—', total: '—' };
    }
    let students = 0;
    let teachers = 0;
    let admins = 0;
    for (const u of classFilteredUsers) {
      if (u.role === 'student') students++;
      else if (u.role === 'teacher') teachers++;
      else if (u.role === 'admin') admins++;
    }
    const total = classFilteredUsers.length;
    return {
      all: total,
      students,
      teachers,
      admins,
      total
    };
  }, [classFilteredUsers, filterStateStatus]);

  // Danh sách người dùng sau khi áp dụng cả globalClassFilter và userRoleFilter
  const filteredUsers = useMemo(() => {
    if (filterStateStatus !== 'OK') {
      return [];
    }
    if (!userRoleFilter || userRoleFilter === 'ALL') {
      return classFilteredUsers;
    }
    return classFilteredUsers.filter(u => u && u.role === userRoleFilter);
  }, [classFilteredUsers, filterStateStatus, userRoleFilter]);

  const handleDeleteGame = async (gameId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa trò chơi này khỏi kho?')) return;

    triggerSound('click');
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('delete_game_safely', { p_game_id: gameId });
      if (rpcErr) throw rpcErr;

      if (rpcRes && rpcRes.success === false) {
        alert(rpcRes.message);
        return;
      }

      alert(rpcRes.message || 'Đã xóa trò chơi thành công.');
      fetchAdminData();
    } catch (err) {
      alert('Không thể xóa trò chơi: ' + err.message);
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

        <button
          onClick={() => { setActiveAdminTab('exercises'); triggerSound('click'); }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeAdminTab === 'exercises'
              ? 'bg-emerald-500 text-white shadow-md border-b-4 border-emerald-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <ShieldCheck className="w-4 h-4" /> Quản Lý Bài Tập Học Thuật
        </button>
        <button
          onClick={() => { setActiveAdminTab('question-bank'); triggerSound('click'); }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeAdminTab === 'question-bank'
              ? 'bg-indigo-600 text-white shadow-md border-b-4 border-indigo-800'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Layers className="w-4 h-4" /> Ngân Hàng Câu Hỏi
        </button>
        <button
          onClick={() => { setActiveAdminTab('exams'); triggerSound('click'); }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeAdminTab === 'exams'
              ? 'bg-purple-600 text-white shadow-md border-b-4 border-purple-800'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <GraduationCap className="w-4 h-4" /> Quản Lý Đề Kiểm Tra
        </button>
      </div>

      {activeAdminTab === 'exercises' && (
        <div className="mb-10">
          <ExerciseListTab role="admin" />
        </div>
      )}
      {activeAdminTab === 'question-bank' && (
        <div className="mb-10 animate-fadeIn">
          <QuestionBankListTab
            role="admin"
            globalClassFilter={globalClassFilter}
          />
        </div>
      )}
      {activeAdminTab === 'exams' && (
        <div className="mb-10 animate-fadeIn">
          <ExamManagementTab
            role="admin"
            classes={classesListState}
            globalClassFilter={globalClassFilter}
          />
        </div>
      )}

      {/* TAB 1: QUẢN LÝ TÀI KHOẢN NGƯỜI DÙNG */}
      {activeAdminTab === 'users' && (
        <div className="mb-10 animate-fadeIn">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <Users className="w-6 h-6 text-amber-600" /> Danh Sách Tài Khoản Người Dùng ({filterStateStatus === 'LOADING' ? '…' : filterStateStatus !== 'OK' ? '—' : filteredUsers.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 ml-1">
                <button
                  type="button"
                  onClick={() => {
                    setUserRoleFilter('ALL');
                    triggerSound('click');
                  }}
                  aria-pressed={userRoleFilter === 'ALL'}
                  className={`px-2.5 py-0.5 border rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    userRoleFilter === 'ALL'
                      ? 'bg-slate-800 text-white border-slate-900 shadow-sm ring-2 ring-slate-400'
                      : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                  }`}
                >
                  🌐 Tất cả: <strong className="font-black">{userRoleCounts.all}</strong>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserRoleFilter('student');
                    triggerSound('click');
                  }}
                  aria-pressed={userRoleFilter === 'student'}
                  className={`px-2.5 py-0.5 border rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    userRoleFilter === 'student'
                      ? 'bg-emerald-700 text-white border-emerald-800 shadow-sm ring-2 ring-emerald-400'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                  }`}
                >
                  🎒 Học sinh: <strong className="font-black">{userRoleCounts.students}</strong>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserRoleFilter('teacher');
                    triggerSound('click');
                  }}
                  aria-pressed={userRoleFilter === 'teacher'}
                  className={`px-2.5 py-0.5 border rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    userRoleFilter === 'teacher'
                      ? 'bg-sky-700 text-white border-sky-800 shadow-sm ring-2 ring-sky-400'
                      : 'bg-sky-50 text-sky-900 border-sky-300 hover:bg-sky-100'
                  }`}
                >
                  👩‍🏫 Giáo viên: <strong className="font-black">{userRoleCounts.teachers}</strong>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserRoleFilter('admin');
                    triggerSound('click');
                  }}
                  aria-pressed={userRoleFilter === 'admin'}
                  className={`px-2.5 py-0.5 border rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                    userRoleFilter === 'admin'
                      ? 'bg-purple-700 text-white border-purple-800 shadow-sm ring-2 ring-purple-400'
                      : 'bg-purple-50 text-purple-900 border-purple-300 hover:bg-purple-100'
                  }`}
                >
                  🛡️ Admin: <strong className="font-black">{userRoleCounts.admins}</strong>
                </button>
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-900 border border-slate-300 rounded-xl text-xs font-bold flex items-center gap-1">
                  👥 Tổng: <strong className="font-black">{userRoleCounts.total}</strong>
                </span>
              </div>
              {filterNote && filterStateStatus === 'OK' && (
                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold">
                  📌 {filterNote}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsImportStudentsOpen(true);
                  triggerSound('click');
                }}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-indigo-800 shadow-md flex items-center gap-2 active:translate-y-0.5"
              >
                <FileSpreadsheet className="w-4 h-4 text-amber-300" /> 📥 Nhập Danh Sách Học Sinh
              </button>

              <button
                onClick={() => {
                  setIsAssignTeacherOpen(true);
                  triggerSound('click');
                }}
                className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-sky-800 shadow-md flex items-center gap-2 active:translate-y-0.5"
              >
                <UserCheck className="w-4 h-4 text-sky-200" /> 👩‍🏫 Phân Công Giáo Viên
              </button>

              <button
                onClick={() => {
                  setIsResetScoresOpen(true);
                  triggerSound('click');
                }}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center gap-2 active:translate-y-0.5"
              >
                <RotateCcw className="w-4 h-4 text-amber-200" /> 🔄 Reset Điểm / Mốc Mới
              </button>

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
          </div>

          <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-left text-xs font-bold whitespace-nowrap">
              <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                <tr>
                  <th className="p-3 text-center w-12">STT</th>
                  <th className="p-3">Họ và Tên</th>
                  <th className="p-3">Mã Học Sinh</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Vai Trò</th>
                  <th className="p-3">Lớp</th>
                  <th className="p-3">Mã Tra Cứu PH</th>
                  <th className="p-3">Khối</th>
                  <th className="p-3">Tổng Sao</th>
                  <th className="p-3">Trạng Thái</th>
                  <th className="p-3 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-slate-700">
                {filterStateStatus === 'LOADING' ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-500 bg-amber-50/20">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                        <span className="font-bold text-xs text-slate-600">Đang tải danh sách người dùng và dữ liệu lớp…</span>
                      </div>
                    </td>
                  </tr>
                ) : filterStateStatus === 'USER_ERROR' ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-rose-600 bg-rose-50/50">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="font-extrabold text-sm">⚠️ Không tải được danh sách người dùng</span>
                        <p className="text-xs text-rose-500">Đã xảy ra lỗi khi tải dữ liệu tài khoản từ hệ thống.</p>
                        <button
                          onClick={() => {
                            fetchAdminData();
                            triggerSound('click');
                          }}
                          className="mt-2 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
                        >
                          🔄 Thử lại
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : filterStateStatus === 'ERROR' ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-rose-600 bg-rose-50/50">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="font-extrabold text-sm">⚠️ Không tải được dữ liệu để lọc theo lớp</span>
                        <p className="text-xs text-rose-500">Đã xảy ra lỗi khi tải danh sách lớp học hoặc thành viên lớp.</p>
                        {setGlobalClassFilter && (
                          <button
                            onClick={() => {
                              setGlobalClassFilter('ALL');
                              triggerSound('click');
                            }}
                            className="mt-2 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
                          >
                            🌐 Xem tất cả người dùng
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : filterStateStatus === 'INVALID_CLASS' ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-amber-800 bg-amber-50/50">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="font-extrabold text-sm">🏫 Lớp đã chọn không tồn tại hoặc không còn khả dụng</span>
                        <p className="text-xs text-amber-700">Vui lòng chọn lớp học khác từ thanh điều hướng.</p>
                        {setGlobalClassFilter && (
                          <button
                            onClick={() => {
                              setGlobalClassFilter('ALL');
                              triggerSound('click');
                            }}
                            className="mt-2 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
                          >
                            🌐 Quay lại tất cả các lớp
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-500 bg-slate-50/50">
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <span className="font-bold text-sm">
                          {userRoleFilter !== 'ALL'
                            ? 'Không có người dùng thuộc vai trò này trong phạm vi lớp hiện tại.'
                            : 'Không có người dùng phù hợp với bộ lọc lớp hiện tại.'}
                        </span>
                        {userRoleFilter !== 'ALL' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setUserRoleFilter('ALL');
                              triggerSound('click');
                            }}
                            className="mt-2 px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                          >
                            Hiển thị tất cả vai trò
                          </button>
                        ) : (
                          globalClassFilter !== 'ALL' && setGlobalClassFilter && (
                            <button
                              type="button"
                              onClick={() => {
                                setGlobalClassFilter('ALL');
                                triggerSound('click');
                              }}
                              className="mt-2 px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                            >
                              Hiển thị tất cả người dùng
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u, index) => {
                    const isSelf = u.id === profile?.id;
                    const isStudent = u.role === 'student';
                    const hasPin = pinStatusMap[u.id] === true;

                    return (
                      <tr key={u.id} className="hover:bg-amber-50">
                        <td className="p-3 text-center font-bold text-slate-500 w-12">
                          {index + 1}
                        </td>
                        <td className="p-3 font-black text-slate-800">
                          <div className="flex items-center gap-2">
                            <img src={u.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'} alt="" className="w-7 h-7 rounded-full bg-slate-100 border border-amber-300" />
                            <span>{u.full_name}</span>
                            {isSelf && (
                              <span className="px-1.5 py-0.5 bg-amber-400 text-amber-950 text-[9px] font-black rounded uppercase">Bạn</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 font-mono font-black text-sky-700">
                          {u.student_code || '—'}
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
                          {u.role === 'admin' ? (
                            <span className="text-slate-300 font-normal">—</span>
                          ) : u.role === 'teacher' ? (
                            classesError ? (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-600 font-bold rounded-lg text-[11px] border border-rose-200">
                                Không tải được
                              </span>
                            ) : (() => {
                              const teacherClasses = teacherClassesById.get(u.id) || [];
                              if (teacherClasses.length === 0) {
                                return (
                                  <span className="text-slate-400 italic font-normal text-[11px]">
                                    Chưa phân công
                                  </span>
                                );
                              }
                              return (
                                <div className="flex flex-wrap gap-1 max-w-[220px]">
                                  {teacherClasses.map(cls => (
                                    <span
                                      key={cls.id}
                                      className="px-2 py-0.5 bg-amber-100 text-amber-800 font-extrabold rounded-lg text-[11px] whitespace-nowrap"
                                    >
                                      {cls.name}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()
                          ) : u.role === 'student' ? (
                            (classesError || classMembersError) ? (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-600 font-bold rounded-lg text-[11px] border border-rose-200">
                                Không tải được
                              </span>
                            ) : (() => {
                              const studentClasses = studentClassesById.get(u.id) || [];
                              if (studentClasses.length === 0) {
                                return (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 font-bold rounded-lg text-[11px]">
                                    Chưa xếp lớp
                                  </span>
                                );
                              }
                              return (
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {studentClasses.map(cls => (
                                    <span
                                      key={cls.id}
                                      className="px-2 py-0.5 bg-sky-100 text-sky-800 font-extrabold rounded-lg text-[11px] whitespace-nowrap"
                                    >
                                      {cls.name}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()
                          ) : (
                            <span className="text-slate-300 font-normal">—</span>
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
                              <>
                                <button
                                  onClick={() => {
                                    setUserForQr(u);
                                    setIsQrModalOpen(true);
                                    triggerSound('click');
                                  }}
                                  className="p-1.5 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 transition-colors"
                                  title="Quản lý Thẻ QR Đăng Nhập"
                                >
                                  <QrCode className="w-4 h-4" />
                                </button>

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
                              </>
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
                  })
                )}
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

      <StudentQrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        student={userForQr}
      />

      <ImportStudentsModal
        isOpen={isImportStudentsOpen}
        onClose={() => setIsImportStudentsOpen(false)}
        onImportCompleted={() => fetchAdminData()}
      />

      <AssignTeacherModal
        isOpen={isAssignTeacherOpen}
        onClose={() => setIsAssignTeacherOpen(false)}
        onSaved={() => fetchAdminData()}
      />

      <ResetScoresModal
        isOpen={isResetScoresOpen}
        onClose={() => setIsResetScoresOpen(false)}
        onApplied={() => fetchAdminData()}
      />

    </div>
  );
};
