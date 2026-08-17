import React, { useState, useEffect } from 'react';
import { 
  BookOpen, Plus, FileText, CheckCircle2, Clock, AlertCircle, 
  Search, Filter, ChevronRight, Star, Send, RotateCcw, Award, Check, Edit3,
  Share2, Users, Layers, AlertTriangle, X, CheckSquare, Square
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { formatClassLabel } from '../../../utils/helpers';
import { CreateExerciseModal } from './CreateExerciseModal';
import { ExercisePlayModal } from './ExercisePlayModal';
import { SubmissionGradingModal } from './SubmissionGradingModal';

export const ExerciseListTab = ({ role = 'student' }) => {
  const { profile } = useAuth();
  
  const [exercises, setExercises] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [assignmentsMap, setAssignmentsMap] = useState({}); // { [exercise_id]: [ { class_id, class_name } ] }
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Modal Nâng Cao
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedExerciseToEdit, setSelectedExerciseToEdit] = useState(null);
  const [selectedExerciseToPlay, setSelectedExerciseToPlay] = useState(null);
  const [selectedSubmissionToGrade, setSelectedSubmissionToGrade] = useState(null);

  // Modal Giao Bài Cho Lớp Nhanh
  const [assignModalExercise, setAssignModalExercise] = useState(null);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [selectedClassIdsToAssign, setSelectedClassIdsToAssign] = useState([]);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  useEffect(() => {
    fetchData();
  }, [role, profile?.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (role === 'student') {
        // 1. Phía Học Sinh: Lấy các lớp mà học sinh tham gia từ class_members
        let myClassIds = [];
        if (profile?.id) {
          const { data: memberData } = await supabase
            .from('class_members')
            .select('class_id')
            .eq('student_id', profile.id);

          myClassIds = (memberData || []).map(m => m.class_id).filter(Boolean);
        }

        // 2. Lấy danh sách exercise_id đã được giao từ academic_exercise_assignments
        let assignedExerciseIds = [];
        if (myClassIds.length > 0) {
          const { data: assignRecords } = await supabase
            .from('academic_exercise_assignments')
            .select('exercise_id')
            .in('class_id', myClassIds);

          assignedExerciseIds = (assignRecords || []).map(a => a.exercise_id).filter(Boolean);
        }

        // 3. Truy vấn các bài tập published khớp đúng lớp học sinh HOẶC bài toàn trường
        let query = supabase
          .from('academic_exercises')
          .select('*, classes:class_id(id, name, grade_level, teacher_id)')
          .eq('status', 'published')
          .order('created_at', { ascending: false });

        const filterConditions = ['is_global.eq.true'];
        if (myClassIds.length > 0) {
          filterConditions.push(`class_id.in.(${myClassIds.join(',')})`);
        }
        if (assignedExerciseIds.length > 0) {
          filterConditions.push(`id.in.(${assignedExerciseIds.join(',')})`);
        }

        query = query.or(filterConditions.join(','));

        const { data: exData, error: exErr } = await query;
        if (!exErr && exData) {
          setExercises(exData);
        }

      } else {
        // Phía Giáo viên & Admin
        let query = supabase
          .from('academic_exercises')
          .select('*, classes:class_id(id, name, grade_level, teacher_id)')
          .order('created_at', { ascending: false });

        if (role === 'teacher' && profile?.id) {
          query = query.eq('teacher_id', profile.id);
        }

        const { data: exData, error: exErr } = await query;
        if (!exErr && exData) {
          setExercises(exData);
        }

        // Lấy thông tin phân công các lớp từ bảng academic_exercise_assignments
        try {
          const { data: allAssignments } = await supabase
            .from('academic_exercise_assignments')
            .select('exercise_id, class_id, classes:class_id(id, name, grade_level)');

          const map = {};
          (allAssignments || []).forEach(a => {
            if (!map[a.exercise_id]) map[a.exercise_id] = [];
            if (a.classes) {
              map[a.exercise_id].push({
                class_id: a.class_id,
                class_name: formatClassLabel(a.classes.name),
                grade_level: a.classes.grade_level
              });
            }
          });
          setAssignmentsMap(map);
        } catch (err) {
          console.warn('Academic exercise assignments fetch warning:', err);
        }
      }

      // Lấy tiến độ / bài nộp của học sinh
      let subQuery = supabase
        .from('academic_submissions')
        .select('*, academic_exercises(*), profiles!student_id(full_name, avatar_url)')
        .order('updated_at', { ascending: false });

      if (role === 'student') {
        subQuery = subQuery.eq('student_id', profile?.id);
      }

      const { data: subData, error: subErr } = await subQuery;
      if (!subErr && subData) {
        setSubmissions(subData);
      }
    } catch (err) {
      console.error('Fetch exercise data error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Mở Modal Giao Cho Lớp
  const handleOpenAssignModal = async (ex) => {
    setAssignModalExercise(ex);
    setAssignError('');
    setSelectedClassIdsToAssign([]);

    // Điền trước các lớp đã được giao
    const existing = assignmentsMap[ex.id] || [];
    if (existing.length > 0) {
      setSelectedClassIdsToAssign(existing.map(e => e.class_id));
    } else if (ex.class_id) {
      setSelectedClassIdsToAssign([ex.class_id]);
    }

    try {
      let query = supabase.from('classes').select('id, name, grade_level');
      if (role === 'teacher' && profile?.id) {
        query = query.eq('teacher_id', profile.id);
      }
      query = query.order('grade_level');

      const { data, error } = await query;
      if (!error) {
        setAvailableClasses(data || []);
      }
    } catch (err) {
      console.error('Fetch available classes error:', err);
    }
  };

  // Thực thi Giao bài tập cho các lớp qua RPC SECURITY DEFINER an toàn bảo mật
  const handleConfirmAssignClasses = async () => {
    if (!assignModalExercise) return;
    if (selectedClassIdsToAssign.length === 0) {
      setAssignError('Vui lòng chọn ít nhất 1 Lớp học để giao bài.');
      return;
    }

    setIsAssigning(true);
    setAssignError('');

    try {
      // 1. Gọi RPC assign_exercise_to_classes kiểm tra phân quyền chặt chẽ trên Database
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('assign_exercise_to_classes', {
        p_exercise_id: assignModalExercise.id,
        p_class_ids: selectedClassIdsToAssign
      });

      if (rpcErr) {
        let userErrMsg = rpcErr.message || 'Lỗi hệ thống.';
        if (userErrMsg.includes('function') || userErrMsg.includes('schema cache') || rpcErr.code === 'PGRST202' || rpcErr.code === 'PGRST205') {
          userErrMsg = '❌ CSDL Supabase chưa nạp RPC [assign_exercise_to_classes]. Vui lòng chạy file CREATE_ACADEMIC_EXERCISE_ASSIGNMENTS_TABLE.sql trong Supabase SQL Editor!';
        }
        setAssignError(userErrMsg);
        setIsAssigning(false);
        return;
      }

      if (!rpcRes || !rpcRes.success) {
        setAssignError(rpcRes?.message || 'Không thể giao bài tập cho các lớp được chọn.');
        setIsAssigning(false);
        return;
      }

      const assignedClassNames = rpcRes.assigned_classes || [];
      const failedClassNames = rpcRes.failed_classes || [];

      let toastNotice = `🎉 Đã xuất bản và giao bài cho lớp [${assignedClassNames.join(', ')}] thành công!`;
      if (failedClassNames.length > 0) {
        toastNotice += ` (⚠️ Lớp chưa được giao do không phụ trách: [${failedClassNames.join(', ')}])`;
      }

      showToast(toastNotice);
      setAssignModalExercise(null);
      fetchData();

    } catch (err) {
      console.error('Assign exercise error:', err);
      setAssignError('Không thể giao bài tập: ' + (err.message || 'Lỗi hệ thống.'));
    } finally {
      setIsAssigning(false);
    }
  };

  const getStudentSubmission = (exerciseId) => {
    return submissions.find(s => s.exercise_id === exerciseId);
  };

  const filteredExercises = exercises.filter(ex => {
    const matchesSearch = ex.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          ex.subject.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;

    if (role === 'student') {
      const sub = getStudentSubmission(ex.id);
      if (activeFilter === 'pending') return !sub || sub.status === 'draft';
      if (activeFilter === 'submitted') return sub && (sub.status === 'submitted' || sub.status === 'pending_manual_grade');
      if (activeFilter === 'graded') return sub && sub.status === 'graded';
      if (activeFilter === 'revision') return sub && sub.status === 'revision_requested';
    }

    return true;
  });

  return (
    <div className="space-y-6">
      
      {/* TOAST FEEDBACK NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[10000] p-4 bg-emerald-600 text-white font-black text-xs rounded-2xl shadow-2xl animate-bounce flex items-center gap-2">
          <span>✨ {toastMsg}</span>
        </div>
      )}

      {/* HEADER BANNER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50 to-orange-50 p-6 rounded-3xl border-2 border-amber-200 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-amber-950 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-amber-600" /> Hệ Thống Bài Tập Học Thuật
          </h2>
          <p className="text-xs font-bold text-amber-800/80 mt-1">
            {role === 'student' ? 'Làm bài tập trắc nghiệm, điền từ, tự luận và nộp file do Thầy/Cô giao.' : 'Quản lý, xuất bản bài tập và chấm điểm bài nộp của học sinh.'}
          </p>
        </div>

        {(role === 'teacher' || role === 'admin') && (
          <button
            onClick={() => { setSelectedExerciseToEdit(null); setIsCreateModalOpen(true); }}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" /> Tạo Bài Tập Mới
          </button>
        )}
      </div>

      {/* SEARCH AND SUB-TABS */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm theo tên bài hoặc môn..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-amber-500"
          />
        </div>

        {role === 'student' && (
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            {[
              { id: 'ALL', label: 'Tất Cả' },
              { id: 'pending', label: 'Chưa Làm' },
              { id: 'submitted', label: 'Đã Nộp' },
              { id: 'graded', label: 'Đã Chấm' },
              { id: 'revision', label: 'Làm Lại' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl font-extrabold text-xs transition-all ${
                  activeFilter === f.id
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-amber-200 hover:bg-amber-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* DANH SÁCH BÀI TẬP */}
      {loading ? (
        <div className="p-8 text-center text-xs font-bold text-slate-400">Đang tải danh sách bài tập...</div>
      ) : filteredExercises.length === 0 ? (
        <div className="bg-white p-8 rounded-3xl border-2 border-dashed border-amber-200 text-center">
          <FileText className="w-12 h-12 text-amber-400 mx-auto mb-2" />
          <h3 className="text-sm font-black text-slate-700">Chưa Có Bài Tập Nào</h3>
          <p className="text-xs font-bold text-slate-400 mt-1">Danh sách bài tập hiện đang trống hoặc chưa có bài tập nào được giao cho lớp của bé.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredExercises.map(ex => {
            const sub = getStudentSubmission(ex.id);
            const isGraded = sub?.status === 'graded';
            const isPending = !sub || sub.status === 'draft';
            const isRevision = sub?.status === 'revision_requested';
            const canEditExercise = role === 'admin' || (role === 'teacher' && (ex.teacher_id === profile?.id || ex.classes?.teacher_id === profile?.id));

            // Xác định thông tin các lớp được giao
            const assignedList = assignmentsMap[ex.id] || [];
            const hasAssignedClasses = assignedList.length > 0 || !!ex.class_id;
            const isUnassignedPublished = ex.status === 'published' && !ex.is_global && !hasAssignedClasses;

            return (
              <div key={ex.id} className="bg-white p-5 rounded-3xl border-2 border-amber-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {/* TRẠNG THÁI HIỂN THỊ LỚP GIAO BÀI TRỰC QUAN */}
                    {ex.is_global ? (
                      <span className="px-2.5 py-0.5 bg-purple-100 text-purple-900 font-black text-[11px] rounded-lg border border-purple-300">
                        🌐 Chung toàn trường
                      </span>
                    ) : assignedList.length > 0 ? (
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-900 font-black text-[11px] rounded-lg border border-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Đã giao: {assignedList.map(a => a.class_name).join(', ')}
                      </span>
                    ) : ex.classes?.name ? (
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-900 font-black text-[11px] rounded-lg border border-emerald-300">
                        Lớp {formatClassLabel(ex.classes.name)}
                      </span>
                    ) : ex.status === 'draft' ? (
                      <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-black text-[11px] rounded-lg border border-slate-300">
                        📝 Bản nháp
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 font-black text-[11px] rounded-lg border border-amber-300 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-600" /> Đã xuất bản – Chưa giao lớp
                      </span>
                    )}

                    <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Hạn: {ex.due_date ? new Date(ex.due_date).toLocaleDateString('vi-VN') : 'Không giới hạn'}
                    </span>
                  </div>

                  <h3 className="text-base font-black text-slate-800 mb-1">{ex.title}</h3>
                  <p className="text-xs font-bold text-slate-500 line-clamp-2 mb-3">{ex.description || 'Không có mô tả chi tiết.'}</p>

                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 bg-sky-50 text-sky-800 font-extrabold text-[10px] rounded-md border border-sky-200">
                      Môn {ex.subject} • {ex.exercise_type === 'mixed' ? 'Hỗn hợp' : ex.exercise_type}
                    </span>
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-800 font-extrabold text-[10px] rounded-md border border-amber-200 flex items-center gap-0.5">
                      +{ex.reward_stars} <Star className="w-3 h-3 fill-amber-400" />
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  {role === 'student' ? (
                    isGraded ? (
                      <div className="w-full flex items-center justify-between bg-emerald-50 p-2.5 rounded-2xl border border-emerald-200 text-emerald-900">
                        <span className="text-xs font-black flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Điểm: {sub.total_score}/{sub.max_score}
                        </span>
                        <button
                          onClick={() => setSelectedExerciseToPlay(ex)}
                          className="px-3 py-1 bg-emerald-600 text-white font-black text-xs rounded-xl hover:bg-emerald-700"
                        >
                          Xem Kết Quả
                        </button>
                      </div>
                    ) : isRevision ? (
                      <div className="w-full flex items-center justify-between bg-rose-50 p-2.5 rounded-2xl border border-rose-200 text-rose-900">
                        <span className="text-xs font-black flex items-center gap-1">
                          <RotateCcw className="w-4 h-4 text-rose-600" /> Cần Làm Lại
                        </span>
                        <button
                          onClick={() => setSelectedExerciseToPlay(ex)}
                          className="px-3 py-1 bg-rose-600 text-white font-black text-xs rounded-xl hover:bg-rose-700"
                        >
                          Làm Lại Ngay
                        </button>
                      </div>
                    ) : isPending ? (
                      <button
                        onClick={() => setSelectedExerciseToPlay(ex)}
                        className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl border-b-4 border-amber-700 shadow-sm flex items-center justify-center gap-1.5"
                      >
                        Bắt Đầu Làm Bài <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <div className="w-full flex items-center justify-between bg-amber-50 p-2.5 rounded-2xl border border-amber-200 text-amber-900">
                        <span className="text-xs font-bold">Đã nộp - Chờ GV chấm</span>
                        <button
                          onClick={() => setSelectedExerciseToPlay(ex)}
                          className="px-3 py-1 bg-slate-800 text-white font-black text-xs rounded-xl"
                        >
                          Xem Bài Nộp
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="w-full flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canEditExercise && (
                          <button
                            onClick={() => setSelectedExerciseToEdit(ex)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg border border-slate-300 flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-amber-600" /> Sửa Bài
                          </button>
                        )}

                        {canEditExercise && !ex.is_global && (
                          <button
                            onClick={() => handleOpenAssignModal(ex)}
                            className={`px-2.5 py-1 font-bold text-xs rounded-lg border flex items-center gap-1 transition-all ${
                              isUnassignedPublished 
                                ? 'bg-amber-500 text-white border-amber-600 shadow-sm hover:bg-amber-600' 
                                : 'bg-sky-50 text-sky-900 border-sky-300 hover:bg-sky-100'
                            }`}
                          >
                            <Share2 className="w-3.5 h-3.5" /> Giao Cho Lớp
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => setSelectedSubmissionToGrade(ex)}
                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1"
                      >
                        Quản Lý & Chấm <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL TẠO & SỬA BÀI TẬP */}
      {(isCreateModalOpen || selectedExerciseToEdit) && (
        <CreateExerciseModal
          isOpen={isCreateModalOpen || !!selectedExerciseToEdit}
          exerciseToEdit={selectedExerciseToEdit}
          onClose={(msg) => { 
            setIsCreateModalOpen(false); 
            setSelectedExerciseToEdit(null); 
            if (msg && typeof msg === 'string') {
              showToast(msg);
            }
            fetchData(); 
          }}
        />
      )}

      {/* MODAL GIAO BÀI CHO LỚP NHANH (ASSIGN ACADEMIC EXERCISE MODAL) */}
      {assignModalExercise && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl border-4 border-amber-300 p-6 shadow-2xl space-y-4 animate-scaleIn">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-black text-slate-800">Giao Bài Tập Cho Lớp Học</h3>
              </div>
              <button
                onClick={() => setAssignModalExercise(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200 text-xs">
              <p className="font-black text-amber-950 mb-0.5">📘 {assignModalExercise.title}</p>
              <p className="text-amber-800">Chọn các lớp nhận bài tập này. Học sinh thuộc lớp được chọn sẽ thấy bài ngay.</p>
            </div>

            {assignError && (
              <div className="p-3 bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{assignError}</span>
              </div>
            )}

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              <span className="text-xs font-black text-slate-700 block">Danh sách Lớp học ({availableClasses.length}):</span>
              {availableClasses.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Không tìm thấy lớp học nào.</p>
              ) : (
                availableClasses.map(c => {
                  const isChecked = selectedClassIdsToAssign.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      onClick={() => {
                        setSelectedClassIdsToAssign(prev => 
                          prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                        );
                      }}
                      className={`flex items-center justify-between p-3 rounded-2xl border-2 cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-amber-50 border-amber-400 text-amber-950 font-black'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 font-bold'
                      }`}
                    >
                      <span className="text-xs">🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})</span>
                      {isChecked ? <CheckSquare className="w-5 h-5 text-amber-600" /> : <Square className="w-5 h-5 text-slate-300" />}
                    </label>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAssignModalExercise(null)}
                disabled={isAssigning}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmAssignClasses}
                disabled={isAssigning || availableClasses.length === 0}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1 disabled:opacity-50"
              >
                {isAssigning ? 'Đang giao...' : 'Xác Nhận Giao Bài'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL LÀM BÀI HỌC SINH */}
      {selectedExerciseToPlay && (
        <ExercisePlayModal
          exercise={selectedExerciseToPlay}
          onClose={() => { setSelectedExerciseToPlay(null); fetchData(); }}
        />
      )}

      {/* MODAL CHẤM BÀI GIÁO VIÊN / ADMIN */}
      {selectedSubmissionToGrade && (
        <SubmissionGradingModal
          exercise={selectedSubmissionToGrade}
          onClose={() => { setSelectedSubmissionToGrade(null); fetchData(); }}
        />
      )}

    </div>
  );
};
