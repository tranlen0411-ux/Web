import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Plus,
  Trash2,
  Save,
  FileText,
  AlertCircle,
  Loader2,
  Send,
  Lock,
  ShieldAlert,
  FileSpreadsheet,
  Award,
  Calendar,
  Layers
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { formatClassLabel } from '../../../utils/helpers';
import { ImportQuestionsModal } from './ImportQuestionsModal';

export const CreateExerciseModal = ({ isOpen, onClose, exerciseToEdit = null }) => {
  const { profile } = useAuth();
  const bodyScrollRef = useRef(null);

  const [classesList, setClassesList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [subject, setSubject] = useState('Toán');
  const [exerciseType, setExerciseType] = useState('mixed');
  const [status, setStatus] = useState('draft');
  const [rewardStars, setRewardStars] = useState(10);
  const [dueDate, setDueDate] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [showScoreAfterSubmit, setShowScoreAfterSubmit] = useState(true);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);

  const [questions, setQuestions] = useState([
    {
      id: 1,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '3 + 4 = ?',
      options: ['5', '6', '7', '8'],
      correct_answer: '7',
      points: 1
    }
  ]);

  const [hasSubmissions, setHasSubmissions] = useState(false);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLockedByKeyError, setIsLockedByKeyError] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // 1. KHÓA CUỘN TRANG NỀN KHI MỞ MODAL VÀ RESET SCROLLTOP = 0
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      if (bodyScrollRef.current) {
        bodyScrollRef.current.scrollTop = 0;
      }

      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // 2. TẢI DANH SÁCH LỚP HỌC
  useEffect(() => {
    if (isOpen) {
      fetchTeacherClasses();
    }
  }, [isOpen, profile?.id]);

  // 3. ĐIỀN DỮ LIỆU KHI EDIT
  useEffect(() => {
    if (isOpen && exerciseToEdit) {
      setTitle(exerciseToEdit.title || '');
      setDescription(exerciseToEdit.description || '');
      setSelectedClassId(exerciseToEdit.class_id || '');
      setIsGlobal(exerciseToEdit.is_global || false);
      setGradeLevel(exerciseToEdit.grade_level || 1);
      setSubject(exerciseToEdit.subject || 'Toán');
      setExerciseType(exerciseToEdit.exercise_type || 'mixed');
      setStatus(exerciseToEdit.status || 'draft');
      setRewardStars(exerciseToEdit.reward_stars || 10);
      setDueDate(exerciseToEdit.due_date ? new Date(exerciseToEdit.due_date).toISOString().slice(0, 16) : '');
      setMaxAttempts(exerciseToEdit.max_attempts || 1);
      setShowScoreAfterSubmit(exerciseToEdit.show_score_after_submit ?? true);
      setShowCorrectAnswers(exerciseToEdit.show_correct_answers ?? false);

      fetchExistingQuestionsWithKeys(exerciseToEdit.id);
    } else if (isOpen && !exerciseToEdit) {
      // Reset về giá trị mặc định cho bài mới
      setTitle('');
      setDescription('');
      setSelectedClassId('');
      setIsGlobal(false);
      setGradeLevel(1);
      setSubject('Toán');
      setExerciseType('mixed');
      setStatus('draft');
      setRewardStars(10);
      setDueDate('');
      setMaxAttempts(1);
      setShowScoreAfterSubmit(true);
      setShowCorrectAnswers(false);
      setQuestions([
        {
          id: Date.now(),
          question_number: 1,
          question_type: 'single_choice',
          prompt: '3 + 4 = ?',
          options: ['5', '6', '7', '8'],
          correct_answer: '7',
          points: 1
        }
      ]);
      setHasSubmissions(false);
      setSubmissionCount(0);
      setErrorMsg('');
      setIsLockedByKeyError(false);
    }
  }, [isOpen, exerciseToEdit]);

  const fetchTeacherClasses = async () => {
    try {
      let query = supabase.from('classes').select('id, name, grade_level');
      if (profile?.role === 'teacher') {
        query = query.eq('teacher_id', profile.id);
      }
      query = query.order('grade_level');

      const { data, error } = await query;
      if (error) throw error;
      setClassesList(data || []);
      if (data && data.length > 0 && !selectedClassId && !exerciseToEdit) {
        setSelectedClassId(data[0].id);
      }
    } catch (err) {
      console.error('Fetch classes error:', err);
    }
  };

  const fetchExistingQuestionsWithKeys = async (exId) => {
    setIsLoadingDetails(true);
    setIsLockedByKeyError(false);
    try {
      const { data: subData } = await supabase
        .from('academic_exercise_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('exercise_id', exId);

      const subCount = subData?.length || 0;
      setSubmissionCount(subCount);
      setHasSubmissions(subCount > 0);

      const { data: qData, error: qErr } = await supabase
        .from('academic_exercise_questions')
        .select('*')
        .eq('exercise_id', exId)
        .order('question_number');
      if (qErr) throw qErr;

      const { data: keyRes, error: keyErr } = await supabase.rpc('get_exercise_answer_keys', {
        p_exercise_id: exId
      });

      if (keyErr || !keyRes?.success) {
        console.error('Fetch keys error:', keyErr || keyRes?.message);
        setErrorMsg('CẢNH BÁO: Không thể tải danh sách đáp án đúng được mã hóa. Đã khóa chức năng lưu để tránh mất dữ liệu đáp án.');
        setIsLockedByKeyError(true);
        return;
      }

      const keysList = keyRes.keys || [];
      const keysMap = {};
      keysList.forEach(k => {
        keysMap[k.question_id] = k.accepted_answers;
      });

      const formattedQuestions = (qData || []).map(q => {
        const accAnswers = keysMap[q.id];
        let correctVal = '';
        if (Array.isArray(accAnswers) && accAnswers.length > 0) {
          correctVal = q.question_type === 'multiple_choice' ? accAnswers : accAnswers[0];
        }

        return {
          id: q.id,
          question_number: q.question_number,
          question_type: q.question_type,
          prompt: q.prompt,
          options: q.options || [],
          correct_answer: correctVal,
          points: q.points || 1
        };
      });

      setQuestions(formattedQuestions.length > 0 ? formattedQuestions : [
        { id: Date.now(), question_number: 1, question_type: 'single_choice', prompt: '', options: ['A', 'B'], correct_answer: 'A', points: 1 }
      ]);

    } catch (err) {
      console.error('Fetch existing questions error:', err);
      setErrorMsg('Lỗi khi tải chi tiết bài tập: ' + err.message);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // 4. XỬ LÝ NHẬP CÂU HỎI TỪ TỆP (EXCEL / WORD) VÀO STATE
  const handleImportQuestions = (importedList) => {
    if (!importedList || importedList.length === 0) return;

    setQuestions(prev => {
      const isDefaultSingleBlank = prev.length === 1 && (!prev[0].prompt || prev[0].prompt === '3 + 4 = ?');
      const formattedImported = importedList.map((q, idx) => ({
        id: Date.now() + idx,
        question_number: isDefaultSingleBlank ? idx + 1 : prev.length + idx + 1,
        question_type: q.question_type,
        prompt: q.prompt,
        options: q.options && q.options.length > 0 ? q.options : (q.question_type === 'single_choice' ? ['Lựa chọn A', 'Lựa chọn B'] : []),
        correct_answer: q.correct_answer,
        points: q.points || 1
      }));

      if (isDefaultSingleBlank) {
        return formattedImported;
      } else {
        const existingKeys = new Set(prev.map(p => `${p.question_type}:::${p.prompt.trim().toLowerCase()}`));
        const nonDuplicates = formattedImported.filter(q => !existingKeys.has(`${q.question_type}:::${q.prompt.trim().toLowerCase()}`));
        return [...prev, ...nonDuplicates];
      }
    });
  };

  // 5. THÊM / XÓA CÂU HỎI THỦ CÔNG
  const handleAddQuestion = () => {
    if (hasSubmissions) return;
    const newId = Date.now();
    setQuestions(prev => [
      ...prev,
      {
        id: newId,
        question_number: prev.length + 1,
        question_type: 'single_choice',
        prompt: '',
        options: ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'],
        correct_answer: 'Lựa chọn A',
        points: 1
      }
    ]);
  };

  const handleRemoveQuestion = (index) => {
    if (hasSubmissions || questions.length <= 1) return;
    setQuestions(prev => prev.filter((_, i) => i !== index));
  };

  // 6. TÍNH TỔNG ĐIỂM
  const totalPoints = questions.reduce((sum, q) => sum + (parseFloat(q.points) || 0), 0);
  const roundedTotalPoints = Math.round(totalPoints * 10) / 10;

  // 7. CẢNH BÁO KHI ĐÓNG NẾU CÓ THAY ĐỔI CHƯA LƯU
  const isDirty = title.trim() !== '' || description.trim() !== '' || (questions.length > 1 || (questions[0]?.prompt && questions[0]?.prompt !== '3 + 4 = ?'));

  const handleSafeClose = () => {
    if (isSubmitting) return;
    if (isDirty) {
      if (window.confirm('Bạn có nội dung bài tập chưa lưu. Bạn có chắc chắn muốn đóng?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  // 8. PHÍM ESC ĐÓNG AN TOÀN
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isImportModalOpen && !isSubmitting) {
        handleSafeClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, isImportModalOpen, isSubmitting]);

  // 9. LƯU BÀI TẬP (LƯU NHÁP / XUẤT BẢN)
  const handleSubmit = async (submitStatus) => {
    if (isSubmitting || isLockedByKeyError) return;

    if (!title.trim()) {
      setErrorMsg('Vui lòng nhập Tiêu đề bài tập.');
      if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
      return;
    }

    if (!isGlobal && !selectedClassId) {
      setErrorMsg('Vui lòng chọn Lớp học được giao bài hoặc chọn "Bài tập chung toàn trường".');
      if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
      return;
    }

    if (!hasSubmissions) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.prompt.trim()) {
          setErrorMsg(`Câu hỏi số ${i + 1} chưa có nội dung đề bài.`);
          return;
        }
        if (q.question_type === 'single_choice') {
          if (!q.options || q.options.length < 2) {
            setErrorMsg(`Câu hỏi số ${i + 1} (Trắc nghiệm) phải có ít nhất 2 lựa chọn.`);
            return;
          }
          if (!q.correct_answer || !q.options.includes(q.correct_answer)) {
            setErrorMsg(`Câu hỏi số ${i + 1} có đáp án đúng không hợp lệ.`);
            return;
          }
        }
        if (q.question_type === 'fill_blank' && !q.correct_answer) {
          setErrorMsg(`Câu hỏi số ${i + 1} (Điền từ) chưa có đáp án đúng.`);
          return;
        }
        if (!q.points || parseFloat(q.points) <= 0) {
          setErrorMsg(`Điểm số của câu hỏi ${i + 1} phải lớn hơn 0.`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const exercisePayload = {
        id: exerciseToEdit ? exerciseToEdit.id : undefined,
        title: title.trim(),
        description: description.trim(),
        class_id: isGlobal ? null : selectedClassId,
        is_global: isGlobal,
        grade_level: parseInt(gradeLevel, 10),
        subject: subject,
        exercise_type: exerciseType,
        status: submitStatus || status,
        reward_stars: parseInt(rewardStars, 10) || 0,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        max_attempts: parseInt(maxAttempts, 10) || 1,
        show_score_after_submit: showScoreAfterSubmit,
        show_correct_answers: showCorrectAnswers
      };

      const questionsPayload = questions.map((q, idx) => ({
        id: typeof q.id === 'string' && q.id.length > 20 ? q.id : undefined,
        question_number: idx + 1,
        question_type: q.question_type,
        prompt: q.prompt.trim(),
        options: ['single_choice', 'multiple_choice'].includes(q.question_type) ? q.options : null,
        points: parseFloat(q.points) || 1,
        answer_key: {
          accepted_answers: Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer],
          case_sensitive: false
        }
      }));

      const { data, error } = await supabase.rpc('save_exercise_with_questions_and_keys', {
        p_exercise: exercisePayload,
        p_questions: questionsPayload
      });

      if (error || !data?.success) {
        setErrorMsg(error?.message || data?.message || 'Lỗi khi lưu bài tập.');
        if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Create/Update exercise exception:', err);
      setErrorMsg(err.message || 'Lỗi hệ thống khi lưu bài tập.');
      if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // SỬ DỤNG REACTDOM.CREATEPORTAL ĐỂ RENDER TRỰC TIẾP LÊN DOCUMENT.BODY
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-exercise-modal-title"
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[92dvh] sm:max-h-[90dvh] rounded-3xl border-4 border-amber-300 shadow-2xl flex flex-col overflow-hidden animate-scaleIn"
      >

        {/* ========================================================= */}
        {/* ZONE A: HEADER (CỐ ĐỊNH PHÍA TRÊN, LUÔN LUÔN NHÌN THẤY) */}
        {/* ========================================================= */}
        <div className="flex items-center justify-between px-5 py-4 sm:px-7 sm:py-5 border-b-2 border-amber-100 bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl border border-amber-300">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 id="create-exercise-modal-title" className="text-base sm:text-lg md:text-xl font-black text-slate-800 leading-tight">
                {exerciseToEdit ? 'Chỉnh Sửa Bài Tập Học Thuật' : 'Tạo Bài Tập Học Thuật Mới'}
              </h2>
              <p className="text-xs font-bold text-slate-500">
                {exerciseToEdit ? 'Cập nhật nội dung bài tập & thang điểm' : 'Soạn bài tập học thuật, gán lớp và thiết lập thang điểm'}
              </p>
            </div>
          </div>
          <button
            onClick={handleSafeClose}
            aria-label="Đóng"
            disabled={isSubmitting}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-colors shrink-0 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ========================================================= */}
        {/* ZONE B: BODY (CUỘN ĐỘC LẬP, CHỨA FORM VÀ DANH SÁCH CÂU HỎI) */}
        {/* ========================================================= */}
        <div
          ref={bodyScrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-7 space-y-6 custom-scrollbar"
        >

          {/* THÔNG BÁO KHÓA CẤU TRÚC NẾU ĐÃ CÓ SUBMISSION */}
          {hasSubmissions && (
            <div className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-2xl text-amber-950 text-xs font-bold flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-black text-sm text-amber-900 mb-0.5">🔒 Bài tập đã có {submissionCount} học sinh nộp bài</p>
                <p className="text-amber-800">Bạn chỉ có thể sửa thông tin chung (tiêu đề, hướng dẫn, hạn nộp, trạng thái); cấu trúc câu hỏi và đáp án đã được khóa để bảo vệ lịch sử bài làm.</p>
              </div>
            </div>
          )}

          {isLoadingDetails && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl text-xs font-bold text-sky-900 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" /> Đang tải đáp án đúng bảo mật từ CSDL...
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-300 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* KHỐI CẤU HÌNH THÔNG TIN BÀI TẬP */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-amber-50/60 p-4 sm:p-5 rounded-3xl border border-amber-200">
            <div className="sm:col-span-2">
              <label className="block text-xs font-black text-amber-950 mb-1">
                Tiêu Đề Bài Tập <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                required
                placeholder="Ví dụ: Ôn tập Toán Khối 1 — Phép cộng trong phạm vi 10"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 shadow-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">
                Gán Cho Lớp Học <span className="text-rose-500">*</span>:
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={isGlobal || hasSubmissions}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 disabled:bg-slate-100 shadow-sm"
              >
                {classesList.map(c => (
                  <option key={c.id} value={c.id}>
                    🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Trạng Thái Xuất Bản:</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 shadow-sm"
              >
                <option value="draft">Bản nháp (draft)</option>
                <option value="published">Đã xuất bản (published)</option>
                <option value="closed">Đóng bài (closed)</option>
                <option value="archived">Lưu trữ (archived)</option>
              </select>
            </div>

            {profile?.role === 'admin' && (
              <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isGlobalCheckModal"
                  checked={isGlobal}
                  disabled={hasSubmissions}
                  onChange={(e) => setIsGlobal(e.target.checked)}
                  className="w-4 h-4 text-amber-500 rounded cursor-pointer"
                />
                <label htmlFor="isGlobalCheckModal" className="text-xs font-black text-amber-900 cursor-pointer">
                  🌐 Bài tập chung toàn trường (is_global - Chỉ Admin tạo)
                </label>
              </div>
            )}

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Môn Học:</label>
              <select
                value={subject}
                disabled={hasSubmissions}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 disabled:bg-slate-100 shadow-sm"
              >
                <option value="Toán">Toán</option>
                <option value="Tiếng Việt">Tiếng Việt</option>
                <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Sao Thưởng Hoàn Thành:</label>
              <input
                type="number"
                min="0"
                max="100"
                disabled={hasSubmissions}
                value={rewardStars}
                onChange={(e) => setRewardStars(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 disabled:bg-slate-100 shadow-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-black text-amber-950 mb-1">Hướng Dẫn Làm Bài Cho Học Sinh:</label>
              <textarea
                rows="2"
                placeholder="Nhập hướng dẫn chi tiết cho các bé..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500 shadow-sm"
              ></textarea>
            </div>
          </div>

          {/* KHỐI DANH SÁCH CÂU HỎI */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-amber-100">
              <div>
                <h3 className="text-sm sm:text-base font-black text-slate-800 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-600" />
                  Danh Sách Câu Hỏi ({questions.length} câu • Tổng {roundedTotalPoints} điểm)
                </h3>
                <p className="text-[11px] font-bold text-slate-500">
                  Tạo trực tiếp hoặc nạp nhanh hàng loạt từ bảng tính Excel
                </p>
              </div>

              {!hasSubmissions && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(true)}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
                  >
                    <FileSpreadsheet className="w-4 h-4" /> Nhập Từ Tệp (Excel/Word)
                  </button>
                  <button
                    type="button"
                    onClick={handleAddQuestion}
                    className="px-3.5 py-2 bg-sky-100 text-sky-900 hover:bg-sky-200 font-black text-xs rounded-2xl border border-sky-300 flex items-center gap-1.5 transition-all active:scale-95"
                  >
                    <Plus className="w-4 h-4" /> Thêm Câu Hỏi
                  </button>
                </div>
              )}
            </div>

            {/* DANH SÁCH CÂU HỎI CHI TIẾT */}
            <div className="space-y-3.5">
              {questions.map((q, idx) => (
                <div key={q.id || idx} className={`p-4 sm:p-5 rounded-3xl border-2 space-y-3.5 transition-all ${hasSubmissions ? 'bg-slate-100 border-slate-300 opacity-90' : 'bg-slate-50 border-slate-200 hover:border-amber-300'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-slate-800 text-white font-black text-xs rounded-xl">
                        Câu {idx + 1}
                      </span>
                      <span className="text-xs font-black text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-lg">
                        {q.points || 1} điểm
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={q.question_type}
                        disabled={hasSubmissions}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQuestions(prev => prev.map((item, i) => {
                            if (i === idx) {
                              let initCorrect = 'Lựa chọn A';
                              if (val === 'multiple_choice') initCorrect = ['Lựa chọn A'];
                              return { ...item, question_type: val, correct_answer: initCorrect };
                            }
                            return item;
                          }));
                        }}
                        className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                      >
                        <option value="single_choice">Trắc nghiệm 1 đáp án</option>
                        <option value="multiple_choice">Trắc nghiệm nhiều đáp án</option>
                        <option value="fill_blank">Điền từ / điền số</option>
                        <option value="short_answer">Trả lời ngắn</option>
                        <option value="essay">Tự luận</option>
                      </select>

                      {!hasSubmissions && questions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveQuestion(idx)}
                          aria-label={`Xóa câu hỏi ${idx + 1}`}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* NỘI DUNG ĐỀ BÀI */}
                  <div>
                    <input
                      type="text"
                      required
                      disabled={hasSubmissions}
                      placeholder="Nhập nội dung đề bài câu hỏi..."
                      value={q.prompt}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, prompt: val } : item));
                      }}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-2xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* CẤU HÌNH ĐIỂM SỐ */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-600">Thang điểm:</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="100"
                      disabled={hasSubmissions}
                      value={q.points}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, points: val } : item));
                      }}
                      className="w-20 px-2.5 py-1 bg-white border border-slate-300 rounded-xl text-xs font-bold disabled:bg-slate-200 text-center"
                    />
                  </div>

                  {/* LỰA CHỌN VÀ ĐÁP ÁN ĐÚNG THEO LOẠI CÂU */}
                  {q.question_type === 'single_choice' && (
                    <div className="space-y-2 pt-2 border-t border-slate-200">
                      <p className="text-xs font-black text-slate-700">Các Lựa Chọn (Tích tròn để chọn đáp án đúng):</p>
                      {q.options?.map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct_choice_${q.id || idx}`}
                            checked={q.correct_answer === opt}
                            disabled={hasSubmissions}
                            onChange={() => {
                              setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: opt } : item));
                            }}
                            className="w-4 h-4 text-amber-500 cursor-pointer"
                          />
                          <input
                            type="text"
                            disabled={hasSubmissions}
                            value={opt}
                            onChange={(e) => {
                              const newOptions = [...q.options];
                              const oldVal = newOptions[optIdx];
                              newOptions[optIdx] = e.target.value;
                              setQuestions(prev => prev.map((item, i) => {
                                if (i === idx) {
                                  const wasSelected = item.correct_answer === oldVal;
                                  return {
                                    ...item,
                                    options: newOptions,
                                    correct_answer: wasSelected ? e.target.value : item.correct_answer
                                  };
                                }
                                return item;
                              }));
                            }}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                          />
                          {!hasSubmissions && q.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newOptions = q.options.filter((_, oI) => oI !== optIdx);
                                setQuestions(prev => prev.map((item, i) => {
                                  if (i === idx) {
                                    return {
                                      ...item,
                                      options: newOptions,
                                      correct_answer: item.correct_answer === opt ? newOptions[0] : item.correct_answer
                                    };
                                  }
                                  return item;
                                }));
                              }}
                              className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}

                      {!hasSubmissions && q.options.length < 6 && (
                        <button
                          type="button"
                          onClick={() => {
                            const newOptions = [...q.options, `Lựa chọn ${String.fromCharCode(65 + q.options.length)}`];
                            setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, options: newOptions } : item));
                          }}
                          className="text-xs font-bold text-sky-700 hover:text-sky-800 flex items-center gap-1 mt-1"
                        >
                          <Plus className="w-3.5 h-3.5" /> Thêm lựa chọn
                        </button>
                      )}
                    </div>
                  )}

                  {['fill_blank', 'short_answer'].includes(q.question_type) && (
                    <div className="pt-2 border-t border-slate-200">
                      <label className="block text-xs font-black text-slate-700 mb-1">Đáp án đúng chính xác:</label>
                      <input
                        type="text"
                        disabled={hasSubmissions}
                        placeholder="Nhập từ hoặc số đáp án đúng..."
                        value={q.correct_answer}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: val } : item));
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  )}

                  {q.question_type === 'essay' && (
                    <div className="pt-2 border-t border-slate-200">
                      <label className="block text-xs font-black text-slate-700 mb-1">Hướng dẫn chấm / Đáp án tham khảo:</label>
                      <input
                        type="text"
                        disabled={hasSubmissions}
                        placeholder="Nhập hướng dẫn chấm bài cho giáo viên..."
                        value={q.correct_answer}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: val } : item));
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  )}

                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ========================================================= */}
        {/* ZONE C: FOOTER (CỐ ĐỊNH PHÍA DƯỚI, LUÔN LUÔN NHÌN THẤY) */}
        {/* ========================================================= */}
        <div className="px-5 py-3.5 sm:px-7 sm:py-4 border-t-2 border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-3 shrink-0 z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={isSubmitting || isLockedByKeyError}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs rounded-2xl flex items-center gap-1.5 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Save className="w-4 h-4" /> Lưu Nháp
            </button>

            {exerciseToEdit && (
              <button
                type="button"
                onClick={() => handleSubmit('closed')}
                disabled={isSubmitting || isLockedByKeyError}
                className="px-4 py-2 bg-rose-100 hover:bg-rose-200 text-rose-900 font-black text-xs rounded-2xl flex items-center gap-1.5 disabled:opacity-50 transition-colors shadow-sm"
              >
                <Lock className="w-4 h-4" /> Đóng Bài Tập
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSafeClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs rounded-2xl transition-colors shadow-sm"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('published')}
              disabled={isSubmitting || isLockedByKeyError}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl shadow-md flex items-center gap-1.5 disabled:opacity-50 transition-all active:scale-95"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isSubmitting ? 'Đang Xuất Bản...' : 'Xuất Bản Ngay'}
            </button>
          </div>
        </div>

      </div>

      {/* MODAL NHẬP CÂU HỎI TỪ TỆP (RENDER BẰNG PORTAL RIÊNG BIỆT) */}
      <ImportQuestionsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportQuestions={handleImportQuestions}
      />
    </div>,
    document.body
  );
};
