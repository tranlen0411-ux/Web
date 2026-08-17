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
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  Award,
  Calendar,
  Layers,
  Check,
  AlertTriangle,
  Edit3
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { formatClassLabel } from '../../../utils/helpers';
import { getQuestionValidationErrors } from '../../../utils/questionFileParsers';
import { ImportQuestionsModal } from './ImportQuestionsModal';

export const CreateExerciseModal = ({ isOpen, onClose, exerciseToEdit = null }) => {
  const { profile } = useAuth();
  const bodyScrollRef = useRef(null);

  // 3-STEP WIZARD STATE
  const [currentStep, setCurrentStep] = useState(1); // 1: Thông tin, 2: Câu hỏi, 3: Xem trước

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
      points: 1,
      source_row: null
    }
  ]);

  const [hasSubmissions, setHasSubmissions] = useState(false);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
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

  // Cuộn lên đầu trang mỗi khi chuyển bước wizard
  useEffect(() => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [currentStep]);

  // 2. TẢI DANH SÁCH LỚP HỌC
  useEffect(() => {
    if (isOpen) {
      fetchTeacherClasses();
    }
  }, [isOpen, profile?.id]);

  // 3. KHỞI TẠO HOẶC ĐIỀN DỮ LIỆU KHI EDIT
  useEffect(() => {
    if (isOpen && exerciseToEdit) {
      setCurrentStep(1);
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
      setCurrentStep(1);
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
          points: 1,
          source_row: null
        }
      ]);
      setHasSubmissions(false);
      setSubmissionCount(0);
      setErrorMsg('');
      setValidationErrors([]);
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
          points: q.points || 1,
          source_row: null
        };
      });

      setQuestions(formattedQuestions.length > 0 ? formattedQuestions : [
        { id: Date.now(), question_number: 1, question_type: 'single_choice', prompt: '', options: ['A', 'B'], correct_answer: 'A', points: 1, source_row: null }
      ]);

    } catch (err) {
      console.error('Fetch existing questions error:', err);
      setErrorMsg('Lỗi khi tải chi tiết bài tập: ' + err.message);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // 4. NHẬP CÂU HỎI TỪ TỆP EXCEL / WORD VÀO STATE
  const handleImportQuestions = (importedList) => {
    if (!importedList || importedList.length === 0) return;

    setQuestions(prev => {
      const isDefaultSingleBlank = prev.length === 1 && (!prev[0].prompt || prev[0].prompt === '3 + 4 = ?');
      const formattedImported = importedList.map((q, idx) => ({
        id: Date.now() + idx,
        question_number: isDefaultSingleBlank ? idx + 1 : prev.length + idx + 1,
        question_type: q.question_type,
        prompt: q.prompt,
        options: q.options && q.options.length > 0
          ? q.options.map(o => String(o || '').trim()).filter(Boolean)
          : (q.question_type === 'single_choice' ? ['Lựa chọn A', 'Lựa chọn B'] : []),
        correct_answer: q.correct_answer,
        points: q.points || 1,
        source_row: q.source_row || null
      }));

      if (isDefaultSingleBlank) {
        return formattedImported;
      } else {
        const existingKeys = new Set(prev.map(p => `${p.question_type}:::${p.prompt.trim().toLowerCase()}`));
        const nonDuplicates = formattedImported.filter(q => !existingKeys.has(`${q.question_type}:::${q.prompt.trim().toLowerCase()}`));
        return [...prev, ...nonDuplicates];
      }
    });

    // Reset danh sách lỗi sau khi nhập mới
    setValidationErrors([]);
    setErrorMsg('');
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
        points: 1,
        source_row: null
      }
    ]);
  };

  const handleRemoveQuestion = (index) => {
    if (hasSubmissions || questions.length <= 1) return;
    setQuestions(prev => prev.filter((_, i) => i !== index));
    setValidationErrors([]);
  };

  // 6. TÍNH TỔNG ĐIỂM
  const totalPoints = questions.reduce((sum, q) => sum + (parseFloat(q.points) || 0), 0);
  const roundedTotalPoints = Math.round(totalPoints * 10) / 10;

  // 7. CẢNH BÁO KHI ĐÓNG NẾU CÓ DỮ LIỆU CHƯA LƯU
  const isDirty = title.trim() !== '' || description.trim() !== '' || (questions.length > 1 || (questions[0]?.prompt && questions[0]?.prompt !== '3 + 4 = ?'));

  const handleSafeClose = () => {
    if (isSubmitting) return;
    if (isDirty) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc chắn muốn đóng và hủy bỏ?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  // 8. KHOẢNG PHÍM ESC ĐÓNG AN TOÀN
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

  // 9. CUỘN TRỰC TIẾP ĐẾN THẺ CÂU HỎI LỖI
  const scrollToQuestion = (idx) => {
    setCurrentStep(2);
    setTimeout(() => {
      const el = document.getElementById(`question-card-${idx}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  // 10. XÁC MINH THEO TỪNG BƯỚC WIZARD
  const validateStep = (stepNumber) => {
    setErrorMsg('');
    setValidationErrors([]);

    if (stepNumber === 1) {
      if (!title.trim()) {
        setErrorMsg('Vui lòng nhập Tiêu đề bài tập.');
        return false;
      }
      if (!isGlobal && !selectedClassId) {
        setErrorMsg('Vui lòng chọn Lớp học hoặc chọn "Bài tập chung toàn trường".');
        return false;
      }
      return true;
    }

    if (stepNumber === 2 || stepNumber === 3) {
      const qErrors = getQuestionValidationErrors(questions, hasSubmissions);
      if (qErrors.length > 0) {
        setValidationErrors(qErrors);
        setErrorMsg(`Phát hiện ${qErrors.length} lỗi trong danh sách câu hỏi. Vui lòng kiểm tra và sửa lỗi bên dưới.`);
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, 3));
    }
  };

  const handlePrevStep = () => {
    setErrorMsg('');
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  // 11. GỬI BÀI TẬP LÊN SUPABASE RPC
  const handleSubmit = async (submitStatus) => {
    if (isSubmitting || isLockedByKeyError) return;

    if (!validateStep(1) || !validateStep(2)) {
      return;
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
        options: ['single_choice', 'multiple_choice'].includes(q.question_type)
          ? (q.options || []).map(o => String(o || '').trim()).filter(Boolean)
          : null,
        points: parseFloat(q.points) || 1,
        answer_key: {
          accepted_answers: Array.isArray(q.correct_answer) ? q.correct_answer : [String(q.correct_answer || '').trim()],
          case_sensitive: false
        }
      }));

      const { data, error } = await supabase.rpc('save_exercise_with_questions_and_keys', {
        p_exercise: exercisePayload,
        p_questions: questionsPayload
      });

      if (error || !data?.success) {
        setErrorMsg(error?.message || data?.message || 'Lỗi khi lưu bài tập.');
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Create/Update exercise exception:', err);
      setErrorMsg(err.message || 'Lỗi hệ thống khi lưu bài tập.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const targetClassName = isGlobal
    ? 'Chung toàn trường'
    : (classesList.find(c => c.id === selectedClassId)?.name ? formatClassLabel(classesList.find(c => c.id === selectedClassId)?.name) : 'Chưa chọn lớp');

  // SỬ DỤNG REACTDOM.CREATEPORTAL NỐI VÀO DOCUMENT.BODY NẰM TRÊN MỌI CONTAINER DASHBOARD
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-exercise-modal-title"
    >
      <div
        className="bg-white w-full max-w-[1000px] max-h-[92dvh] sm:max-h-[90dvh] rounded-3xl border-4 border-amber-300 shadow-2xl flex flex-col overflow-hidden animate-scaleIn"
      >

        {/* ========================================================= */}
        {/* HEADER CỐ ĐỊNH PHÍA TRÊN: THÔNG TIN VÀ WIZARD PROGRESS */}
        {/* ========================================================= */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 sm:px-7 sm:py-4 border-b-2 border-amber-100 bg-white shrink-0 gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-900 rounded-2xl border border-amber-300">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 id="create-exercise-modal-title" className="text-base sm:text-lg md:text-xl font-black text-slate-800 leading-tight">
                {exerciseToEdit ? 'Chỉnh Sửa Bài Tập Học Thuật' : 'Tạo Bài Tập Học Thuật Mới'}
              </h2>
              <p className="text-xs font-bold text-amber-700">
                Bước {currentStep}/3: {currentStep === 1 ? 'Thông Tin Cấu Hình' : currentStep === 2 ? 'Soạn Đề & Nhập Excel' : 'Xem Trước & Hoàn Tất'}
              </p>
            </div>
          </div>

          {/* WIZARD STEP INDICATORS */}
          <div className="flex items-center gap-2">
            {[
              { num: 1, label: '1. Thông tin' },
              { num: 2, label: '2. Câu hỏi' },
              { num: 3, label: '3. Xem trước' }
            ].map(s => (
              <button
                key={s.num}
                type="button"
                onClick={() => {
                  if (s.num < currentStep || validateStep(currentStep)) {
                    setCurrentStep(s.num);
                  }
                }}
                className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                  currentStep === s.num
                    ? 'bg-amber-500 text-white shadow-sm'
                    : currentStep > s.num
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {currentStep > s.num ? <Check className="w-3.5 h-3.5 text-amber-700" /> : null}
                <span>{s.label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={handleSafeClose}
              aria-label="Đóng"
              disabled={isSubmitting}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-colors shrink-0 disabled:opacity-50 ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* BODY CUỘN ĐỘC LẬP (FLEX-1 MIN-H-0 OVERFLOW-Y-AUTO) */}
        {/* ========================================================= */}
        <div
          ref={bodyScrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-7 space-y-5 custom-scrollbar bg-slate-50/40"
        >

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
            <div className="p-3.5 bg-rose-50 border-2 border-rose-300 text-rose-900 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* DANH SÁCH CÁC LỖI VALIDATION CHI TIẾT */}
          {validationErrors.length > 0 && (
            <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl space-y-2 text-xs">
              <p className="font-black text-rose-950 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                Vui lòng chỉnh sửa các lỗi sau trong danh sách câu hỏi:
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pl-2 custom-scrollbar">
                {validationErrors.map((err, errIdx) => (
                  <div key={errIdx} className="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-rose-200">
                    <span className="font-bold text-rose-900">• {err.message}</span>
                    <button
                      type="button"
                      onClick={() => scrollToQuestion(err.index)}
                      className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-black text-[11px] rounded-lg shadow-sm shrink-0 flex items-center gap-1 transition-colors"
                    >
                      <Edit3 className="w-3 h-3" /> Sửa ngay
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* BƯỚC 1: THÔNG TIN BÀI TẬP */}
          {/* ========================================================= */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 bg-amber-100/50 rounded-2xl border border-amber-200">
                <h3 className="text-sm font-black text-amber-950 flex items-center gap-2 mb-1">
                  📌 Bước 1: Thiết lập thông tin chung cho bài tập
                </h3>
                <p className="text-xs font-bold text-slate-600">
                  Điền tên bài tập, gán cho lớp học áp dụng và các tùy chọn thưởng sao hoàn thành.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-5 rounded-3xl border-2 border-amber-200 shadow-sm">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    Tiêu Đề Bài Tập <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Ôn tập Toán Khối 1 — Phép cộng trong phạm vi 10"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    Gán Cho Lớp Học <span className="text-rose-500">*</span>:
                  </label>
                  <select
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    disabled={isGlobal || hasSubmissions}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400 disabled:bg-slate-100"
                  >
                    {classesList.map(c => (
                      <option key={c.id} value={c.id}>
                        🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">Trạng Thái Xuất Bản:</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
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
                      id="isGlobalCheckWizard"
                      checked={isGlobal}
                      disabled={hasSubmissions}
                      onChange={(e) => setIsGlobal(e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded cursor-pointer"
                    />
                    <label htmlFor="isGlobalCheckWizard" className="text-xs font-black text-amber-900 cursor-pointer">
                      🌐 Bài tập chung toàn trường (is_global - Chỉ Admin tạo)
                    </label>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">Môn Học:</label>
                  <select
                    value={subject}
                    disabled={hasSubmissions}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400 disabled:bg-slate-100"
                  >
                    <option value="Toán">Toán</option>
                    <option value="Tiếng Việt">Tiếng Việt</option>
                    <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">Sao Thưởng Hoàn Thành:</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={hasSubmissions}
                    value={rewardStars}
                    onChange={(e) => setRewardStars(e.target.value)}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400 disabled:bg-slate-100"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-black text-slate-800 mb-1">Hướng Dẫn Làm Bài Cho Học Sinh:</label>
                  <textarea
                    rows="3"
                    placeholder="Nhập hướng dẫn chi tiết cho các bé trước khi làm bài..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
                  ></textarea>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* BƯỚC 2: SOẠN CÂU HỎI HOẶC NHẬP TỰ ĐỘNG TỪ EXCEL */}
          {/* ========================================================= */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-3xl border-2 border-amber-200 shadow-sm">
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-800 flex items-center gap-2">
                    <Layers className="w-5 h-5 text-amber-600" />
                    Danh Sách Câu Hỏi ({questions.length} câu • Tổng {roundedTotalPoints} điểm)
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    Thêm câu thủ công hoặc nạp nhanh hàng loạt bằng file Excel/Word
                  </p>
                </div>

                {!hasSubmissions && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setIsImportModalOpen(true)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
                    >
                      <FileSpreadsheet className="w-4 h-4" /> Nhập Từ Tệp (Excel/Word)
                    </button>
                    <button
                      type="button"
                      onClick={handleAddQuestion}
                      className="px-4 py-2 bg-sky-100 text-sky-900 hover:bg-sky-200 font-black text-xs rounded-2xl border border-sky-300 flex items-center gap-1.5 transition-all active:scale-95"
                    >
                      <Plus className="w-4 h-4" /> Thêm Câu Hỏi
                    </button>
                  </div>
                )}
              </div>

              {/* DANH SÁCH CÂU HỎI CHI TIẾT */}
              <div className="space-y-3.5">
                {questions.map((q, idx) => {
                  const cardErrors = validationErrors.filter(e => e.index === idx);
                  const hasErr = cardErrors.length > 0;

                  return (
                    <div
                      key={q.id || idx}
                      id={`question-card-${idx}`}
                      className={`p-4 sm:p-5 rounded-3xl border-2 bg-white space-y-3.5 transition-all ${
                        hasErr
                          ? 'border-rose-400 bg-rose-50/40 shadow-md ring-2 ring-rose-300/50'
                          : hasSubmissions
                          ? 'border-slate-300 opacity-90'
                          : 'border-amber-200 shadow-sm hover:border-amber-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 bg-slate-800 text-white font-black text-xs rounded-xl flex items-center gap-1">
                            Câu {idx + 1}
                            {q.source_row ? (
                              <span className="text-[10px] text-amber-300 font-normal">
                                (Dòng Excel {q.source_row})
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs font-black text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-lg">
                            {q.points || 1} điểm
                          </span>
                          {hasErr && (
                            <span className="text-[11px] font-black text-rose-600 bg-rose-100 px-2 py-0.5 rounded-lg flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Có {cardErrors.length} lỗi
                            </span>
                          )}
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
                              setValidationErrors([]);
                            }}
                            className="px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
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

                      {/* KHỐI CẢNH BÁO LỖI RIÊNG CHO CÂU NÀY */}
                      {hasErr && (
                        <div className="p-3 bg-rose-100/90 border border-rose-300 rounded-2xl text-xs font-bold text-rose-900 space-y-1">
                          {cardErrors.map((err, errIdx) => (
                            <p key={errIdx} className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                              <span>{err.message}</span>
                            </p>
                          ))}
                        </div>
                      )}

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
                            setValidationErrors([]);
                          }}
                          className={`w-full p-3 bg-amber-50/50 border rounded-2xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400 ${
                            cardErrors.some(e => e.field === 'prompt') ? 'border-rose-400 bg-rose-50/50' : 'border-amber-200'
                          }`}
                        />
                      </div>

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
                            setValidationErrors([]);
                          }}
                          className="w-20 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold disabled:bg-slate-200 text-center"
                        />
                      </div>

                      {['single_choice', 'multiple_choice'].includes(q.question_type) && (
                        <div className="space-y-2 pt-2 border-t border-amber-100">
                          <p className="text-xs font-black text-slate-700">Các Lựa Chọn (Tích tròn để chọn đáp án đúng):</p>
                          {q.options?.map((opt, optIdx) => (
                            <div key={optIdx} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`correct_choice_step2_${q.id || idx}`}
                                checked={q.correct_answer === opt}
                                disabled={hasSubmissions}
                                onChange={() => {
                                  setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: opt } : item));
                                  setValidationErrors([]);
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
                                  setValidationErrors([]);
                                }}
                                className="flex-1 p-2.5 bg-amber-50/50 border border-amber-200 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
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
                                    setValidationErrors([]);
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
                                setValidationErrors([]);
                              }}
                              className="text-xs font-bold text-sky-700 hover:text-sky-800 flex items-center gap-1 mt-1"
                            >
                              <Plus className="w-3.5 h-3.5" /> Thêm lựa chọn
                            </button>
                          )}
                        </div>
                      )}

                      {['fill_blank', 'short_answer'].includes(q.question_type) && (
                        <div className="pt-2 border-t border-amber-100">
                          <label className="block text-xs font-black text-slate-700 mb-1">Đáp án đúng chính xác:</label>
                          <input
                            type="text"
                            disabled={hasSubmissions}
                            placeholder="Nhập từ hoặc số đáp án đúng..."
                            value={q.correct_answer}
                            onChange={(e) => {
                              const val = e.target.value;
                              setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: val } : item));
                              setValidationErrors([]);
                            }}
                            className="w-full p-2.5 bg-amber-50/50 border border-amber-200 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                          />
                        </div>
                      )}

                      {q.question_type === 'essay' && (
                        <div className="pt-2 border-t border-amber-100">
                          <label className="block text-xs font-black text-slate-700 mb-1">Hướng dẫn chấm / Đáp án tham khảo:</label>
                          <input
                            type="text"
                            disabled={hasSubmissions}
                            placeholder="Nhập hướng dẫn chấm bài cho giáo viên..."
                            value={q.correct_answer}
                            onChange={(e) => {
                              const val = e.target.value;
                              setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: val } : item));
                              setValidationErrors([]);
                            }}
                            className="w-full p-2.5 bg-amber-50/50 border border-amber-200 rounded-xl text-xs font-bold disabled:bg-slate-200 focus:outline-none focus:border-amber-400"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* BƯỚC 3: XEM TRƯỚC VÀ XÁC NHẬN LƯU BÀI TẬP */}
          {/* ========================================================= */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 bg-emerald-50 rounded-3xl border-2 border-emerald-200">
                <h3 className="text-sm sm:text-base font-black text-emerald-950 flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Bước 3: Tóm tắt thông tin & Xem trước câu hỏi
                </h3>
                <p className="text-xs font-bold text-emerald-800">
                  Vui lòng kiểm tra lại toàn bộ thông tin trước khi chọn "Lưu Nháp" hoặc "Xuất Bản Ngay".
                </p>
              </div>

              {/* TÓM TẮT CẤU HÌNH */}
              <div className="bg-white p-5 rounded-3xl border-2 border-amber-200 shadow-sm space-y-3">
                <h4 className="text-xs font-black text-amber-950 uppercase border-b border-amber-100 pb-2">
                  1. Thông tin cấu hình bài tập:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-bold text-slate-700">
                  <p>📖 Tiêu đề: <span className="text-slate-900 font-black">{title || 'Chưa nhập'}</span></p>
                  <p>🏫 Lớp áp dụng: <span className="text-sky-700 font-black">{targetClassName}</span></p>
                  <p>📚 Môn học: <span className="text-slate-900">{subject}</span></p>
                  <p>🌟 Thưởng: <span className="text-amber-600 font-black">+{rewardStars} sao</span></p>
                  <p>📌 Trạng thái mặc định: <span className="text-emerald-700 font-black">{status}</span></p>
                  <p>📊 Quy mô: <span className="text-slate-900 font-black">{questions.length} câu • Tổng {roundedTotalPoints} điểm</span></p>
                </div>
              </div>

              {/* TÓM TẮT CÂU HỎI */}
              <div className="bg-white p-5 rounded-3xl border-2 border-amber-200 shadow-sm space-y-3">
                <h4 className="text-xs font-black text-amber-950 uppercase border-b border-amber-100 pb-2">
                  2. Xem trước danh sách câu hỏi ({questions.length} câu):
                </h4>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                  {questions.map((q, idx) => (
                    <div key={idx} className="p-3 bg-amber-50/60 rounded-2xl border border-amber-200 text-xs font-bold text-slate-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-black text-slate-900">
                          Câu {idx + 1}{q.source_row ? ` (Dòng Excel ${q.source_row})` : ''}: {q.prompt}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-700 font-black">({q.points}đ)</span>
                          <button
                            type="button"
                            onClick={() => scrollToQuestion(idx)}
                            className="text-xs text-sky-700 hover:underline font-bold flex items-center gap-0.5"
                          >
                            <Edit3 className="w-3 h-3" /> Sửa
                          </button>
                        </div>
                      </div>
                      {q.options && q.options.length > 0 && (
                        <p className="text-[11px] text-slate-600 pl-2">Lựa chọn: {q.options.join(' | ')}</p>
                      )}
                      <p className="text-[11px] text-emerald-700 font-black pl-2">
                        Đáp án đúng: {Array.isArray(q.correct_answer) ? q.correct_answer.join(', ') : q.correct_answer}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* ========================================================= */}
        {/* FOOTER CỐ ĐỊNH PHÍA DƯỚI: NÚT ĐIỀU HƯỚNG WIZARD VÀ LƯU */}
        {/* ========================================================= */}
        <div className="px-5 py-3.5 sm:px-7 sm:py-4 border-t-2 border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-3 shrink-0 z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={currentStep === 1 || isSubmitting}
              className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-black text-xs rounded-2xl flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Quay Lại
            </button>

            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={isSubmitting || isLockedByKeyError}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs rounded-2xl flex items-center gap-1.5 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Save className="w-4 h-4" /> Lưu Nháp
            </button>
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

            {currentStep < 3 ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={isSubmitting}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs sm:text-sm rounded-2xl shadow-md flex items-center gap-1.5 transition-all active:scale-95"
              >
                <span>Tiếp Tục</span> <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit('published')}
                disabled={isSubmitting || isLockedByKeyError}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-2xl shadow-md flex items-center gap-1.5 disabled:opacity-50 transition-all active:scale-95"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {isSubmitting ? 'Đang Xuất Bản...' : 'Xuất Bản Ngay'}
              </button>
            )}
          </div>
        </div>

      </div>

      {/* MODAL NHẬP CÂU HỎI TỪ TỆP (EXCEL / WORD) PORTAL */}
      <ImportQuestionsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportQuestions={handleImportQuestions}
      />
    </div>,
    document.body
  );
};
