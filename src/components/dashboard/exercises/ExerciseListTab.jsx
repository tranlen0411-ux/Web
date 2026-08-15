import React, { useState, useEffect } from 'react';
import { 
  BookOpen, Plus, FileText, CheckCircle2, Clock, AlertCircle, 
  Search, Filter, ChevronRight, Star, Send, RotateCcw, Award, Check
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { CreateExerciseModal } from './CreateExerciseModal';
import { ExercisePlayModal } from './ExercisePlayModal';
import { SubmissionGradingModal } from './SubmissionGradingModal';

export const ExerciseListTab = ({ role = 'student' }) => {
  const { profile } = useAuth();
  
  const [exercises, setExercises] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('ALL'); // ALL, pending, submitted, graded, revision
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedExerciseToPlay, setSelectedExerciseToPlay] = useState(null);
  const [selectedSubmissionToGrade, setSelectedSubmissionToGrade] = useState(null);

  useEffect(() => {
    fetchData();
  }, [role, profile?.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Lấy danh sách bài tập
      let query = supabase
        .from('academic_exercises')
        .select('*')
        .order('created_at', { ascending: false });

      if (role === 'student') {
        query = query.eq('status', 'published');
      } else if (role === 'teacher') {
        query = query.eq('teacher_id', profile?.id);
      }

      const { data: exData, error: exErr } = await query;
      if (!exErr && exData) {
        setExercises(exData);
      }

      // 2. Lấy danh sách bài nộp
      let subQuery = supabase
        .from('academic_submissions')
        .select('*, academic_exercises(*), profiles!student_id(full_name, avatar_url, class_name)')
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

  // Helper tìm submission của học sinh theo exercise_id
  const getStudentSubmission = (exerciseId) => {
    return submissions.find(s => s.exercise_id === exerciseId);
  };

  // Lọc danh sách bài tập
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
      
      {/* BANNER HEADER & NÚT TẠO BÀI TẬP */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50 to-orange-50 p-6 rounded-3xl border-2 border-amber-200 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-amber-950 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-amber-600" /> Hệ Thống Bài Tập Học Thuật
          </h2>
          <p className="text-xs font-bold text-amber-800/80 mt-1">
            {role === 'student' ? 'Làm bài trắc nghiệm, điền từ và nộp bài tự luận được giáo viên giao.' : 'Quản lý, tạo mới bài tập và chấm điểm bài nộp của học sinh.'}
          </p>
        </div>

        {(role === 'teacher' || role === 'admin') && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" /> Tạo Bài Tập Mới
          </button>
        )}
      </div>

      {/* THANH TÌM KIẾM VÀ BỘ LỌC SUB-TABS */}
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
          <h3 className="text-sm font-black text-slate-700">Chưa Có Bài Tập Phù Hợp</h3>
          <p className="text-xs font-bold text-slate-400 mt-1">Danh sách bài tập hiện đang trống hoặc không tìm thấy bài khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredExercises.map(ex => {
            const sub = getStudentSubmission(ex.id);
            const isGraded = sub?.status === 'graded';
            const isPending = !sub || sub.status === 'draft';
            const isRevision = sub?.status === 'revision_requested';

            return (
              <div key={ex.id} className="bg-white p-5 rounded-3xl border-2 border-amber-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 font-black text-[11px] rounded-lg border border-amber-300">
                      Môn {ex.subject} - {ex.class_name}
                    </span>
                    <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Hạn: {ex.due_date ? new Date(ex.due_date).toLocaleDateString('vi-VN') : 'Không giới hạn'}
                    </span>
                  </div>

                  <h3 className="text-base font-black text-slate-800 mb-1">{ex.title}</h3>
                  <p className="text-xs font-bold text-slate-500 line-clamp-2 mb-3">{ex.description || 'Không có mô tả chi tiết.'}</p>

                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 bg-sky-50 text-sky-800 font-extrabold text-[10px] rounded-md border border-sky-200">
                      Dạng: {ex.exercise_type === 'mixed' ? 'Hỗn hợp' : ex.exercise_type}
                    </span>
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-800 font-extrabold text-[10px] rounded-md border border-amber-200 flex items-center gap-0.5">
                      +{ex.reward_stars} <Star className="w-3 h-3 fill-amber-400" />
                    </span>
                  </div>
                </div>

                {/* THAO TÁC THEO VAI TRÒ */}
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
                        <span className="text-xs font-bold">Đã nộp - Đang chờ GV chấm</span>
                        <button
                          onClick={() => setSelectedExerciseToPlay(ex)}
                          className="px-3 py-1 bg-slate-800 text-white font-black text-xs rounded-xl"
                        >
                          Xem Bài Nộp
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="w-full flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-500">
                        Trạng thái: <strong className="text-slate-800">{ex.status}</strong>
                      </span>
                      <button
                        onClick={() => setSelectedSubmissionToGrade(ex)}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1"
                      >
                        Quản Lý & Chấm Bài <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL TẠO BÀI TẬP MỚI */}
      {isCreateModalOpen && (
        <CreateExerciseModal
          isOpen={isCreateModalOpen}
          onClose={() => { setIsCreateModalOpen(false); fetchData(); }}
        />
      )}

      {/* MODAL LÀM BÀI VÀ XEM KẾT QUẢ CHO HỌC SINH */}
      {selectedExerciseToPlay && (
        <ExercisePlayModal
          exercise={selectedExerciseToPlay}
          onClose={() => { setSelectedExerciseToPlay(null); fetchData(); }}
        />
      )}

      {/* MODAL CHẤM BÀI CHO GIÁO VIÊN / ADMIN */}
      {selectedSubmissionToGrade && (
        <SubmissionGradingModal
          exercise={selectedSubmissionToGrade}
          onClose={() => { setSelectedSubmissionToGrade(null); fetchData(); }}
        />
      )}

    </div>
  );
};
