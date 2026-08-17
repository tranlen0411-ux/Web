import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Trash2, Save, FileText, AlertCircle, Loader2, Send, Lock,
  ShieldAlert, FileSpreadsheet, ArrowLeft, ArrowRight, CheckCircle2,
  HelpCircle, Award, Calendar, Layers, Check, AlertTriangle, Edit3,
  CheckSquare, Square
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { formatClassLabel } from '../../../utils/helpers';
import {
  getQuestionValidationErrors,
  normalizeImportedQuestion
} from '../../../utils/questionFileParsers';
import { ImportQuestionsModal } from './ImportQuestionsModal';

export const CreateExerciseModal = ({ isOpen, onClose, exerciseToEdit = null }) => {
  const { profile } = useAuth();
  const bodyScrollRef = useRef(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [classesList, setClassesList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState([]);
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
      options_json: ['5', '6', '7', '8'],
      correct_answer: '7',
      correct_answer_key: {
        correct_answer: '7',
        accepted_answers: ['7'],
        case_sensitive: false
      },
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

  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
      return () => { document.body.style.overflow = originalOverflow; };
    }
  }, [isOpen]);

  useEffect(() => {
    if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
  }, [currentStep]);

  useEffect(() => {
    if (isOpen) fetchTeacherClasses();
  }, [isOpen, profile?.id]);

  useEffect(() => {
    if (isOpen && exerciseToEdit) {
      setCurrentStep(1);
      setTitle(exerciseToEdit.title || '');
      setDescription(exerciseToEdit.description || '');
      setSelectedClassId(exerciseToEdit.class_id || '');
      setSelectedClassIds(exerciseToEdit.class_id ? [exerciseToEdit.class_id] : []);
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
      setSelectedClassIds([]);
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
          options_json: ['5', '6', '7', '8'],
          correct_answer: '7',
          correct_answer_key: { correct_answer: '7', accepted_answers: ['7'], case_sensitive: false },
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
      const list = data || [];
      setClassesList(list);
      if (list.length > 0 && !selectedClassId && !exerciseToEdit) {
        setSelectedClassId(list[0].id);
        setSelectedClassIds([list[0].id]);
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
        .from('academic_submissions')
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
        setErrorMsg('CẢNH BÁO: Không thể tải đáp án bí mật.');
        setIsLockedByKeyError(true);
        return;
      }

      const keysList = keyRes.keys || [];
      const keysMap = {};
      keysList.forEach(k => { keysMap[k.question_id] = k.accepted_answers; });

      const formattedQuestions = (qData || []).map((q, qIdx) => {
        const accAnswers = keysMap[q.id];
        let correctVal = '';
        if (Array.isArray(accAnswers) && accAnswers.length > 0) {
          correctVal = q.question_type === 'multiple_choice' ? accAnswers : accAnswers[0];
        }

        return normalizeImportedQuestion({
          id: q.id,
          question_number: q.question_number,
          question_type: q.question_type,
          prompt: q.prompt,
          options: q.options_json,
          options_json: q.options_json,
          correct_answer: correctVal,
          points: q.points || 1,
          source_row: null
        }, qIdx);
      });

      setQuestions(formattedQuestions.length > 0 ? formattedQuestions : [
        { id: Date.now(), question_number: 1, question_type: 'single_choice', prompt: '', options: ['A', 'B'], options_json: ['A', 'B'], correct_answer: 'A', correct_answer_key: { correct_answer: 'A', accepted_answers: ['A'], case_sensitive: false }, points: 1, source_row: null }
      ]);
    } catch (err) {
      setErrorMsg('Lỗi khi tải chi tiết bài tập: ' + err.message);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleImportQuestions = (importedList) => {
    if (!importedList || importedList.length === 0) return;
    setQuestions(prev => {
      const isDefaultSingleBlank = prev.length === 1 && (!prev[0].prompt || prev[0].prompt === '3 + 4 = ?');
      const formattedImported = importedList.map((q, idx) => {
        const targetNum = isDefaultSingleBlank ? idx + 1 : prev.length + idx + 1;
        return normalizeImportedQuestion({ ...q, question_number: targetNum }, idx);
      });

      if (isDefaultSingleBlank) return formattedImported;
      const existingKeys = new Set(prev.map(p => `${p.question_type}:::${p.prompt.trim().toLowerCase()}`));
      const nonDuplicates = formattedImported.filter(q => !existingKeys.has(`${q.question_type}:::${q.prompt.trim().toLowerCase()}`));
      return [...prev, ...nonDuplicates];
    });
    setValidationErrors([]);
    setErrorMsg('');
  };

  const handleAddQuestion = () => {
    if (hasSubmissions) return;
    const newQ = normalizeImportedQuestion({
      id: Date.now(),
      question_number: questions.length + 1,
      question_type: 'single_choice',
      prompt: '',
      options: ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'],
      correct_answer: 'Lựa chọn A',
      points: 1,
      source_row: null
    }, questions.length);
    setQuestions(prev => [...prev, newQ]);
  };

  const handleRemoveQuestion = (index) => {
    if (hasSubmissions || questions.length <= 1) return;
    setQuestions(prev => prev.filter((_, i) => i !== index));
    setValidationErrors([]);
  };

  const totalPoints = questions.reduce((sum, q) => sum + (parseFloat(q.points) || 0), 0);
  const roundedTotalPoints = Math.round(totalPoints * 10) / 10;
  const isDirty = title.trim() !== '' || description.trim() !== '';

  const handleSafeClose = () => {
    if (isSubmitting) return;
    if (isDirty) {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc chắn muốn đóng?')) onClose();
    } else {
      onClose();
    }
  };

  const validateStep = (stepNumber) => {
    setErrorMsg('');
    setValidationErrors([]);
    if (stepNumber === 1) {
      if (!title.trim()) {
        setErrorMsg('Vui lòng nhập Tiêu đề bài tập.');
        return false;
      }
      return true;
    }
    if (stepNumber === 2 || stepNumber === 3) {
      const qErrors = getQuestionValidationErrors(questions, hasSubmissions);
      if (qErrors.length > 0) {
        setValidationErrors(qErrors);
        setErrorMsg(`Phát hiện ${qErrors.length} lỗi trong danh sách câu hỏi.`);
        return false;
      }
      return true;
    }
    return true;
  };

  const handleNextStep = () => {
    if (validateStep(currentStep)) setCurrentStep(prev => Math.min(prev + 1, 3));
  };

  const handlePrevStep = () => {
    setErrorMsg('');
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  // submitAction: 'draft' | 'publish_only' | 'publish_and_assign'
  const handleSubmit = async (submitAction = 'publish_and_assign') => {
    if (isSubmitting || isLockedByKeyError) return;
    if (!validateStep(1) || !validateStep(2)) return;

    let finalStatus = 'published';
    if (submitAction === 'draft') {
      finalStatus = 'draft';
    }

    const targetClassesToAssign = isGlobal 
      ? [] 
      : (profile?.role === 'admin' 
          ? selectedClassIds 
          : (selectedClassId ? [selectedClassId] : []));

    // Nếu bấm "Xuất bản & Giao bài" mà chưa chọn lớp nào (và không phải bài chung toàn trường) -> Yêu cầu chọn lớp
    if (submitAction === 'publish_and_assign' && !isGlobal && targetClassesToAssign.length === 0) {
      setErrorMsg('Vui lòng chọn ít nhất 1 Lớp học để giao bài tập trước khi Giao bài.');
      setCurrentStep(1);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const questionsPayload = questions.map((q, idx) => {
        const normQ = normalizeImportedQuestion(q, idx);
        return {
          id: typeof normQ.id === 'string' && normQ.id.length > 20 ? normQ.id : undefined,
          question_number: idx + 1,
          question_type: normQ.question_type,
          prompt: normQ.prompt,
          options_json: normQ.options_json,
          options: normQ.options_json,
          points: normQ.points,
          correct_answer_key: normQ.question_type === 'essay' ? null : normQ.correct_answer_key
        };
      });

      const singleClassId = isGlobal ? null : (targetClassesToAssign[0] || selectedClassId || null);
      const exercisePayload = {
        id: exerciseToEdit ? exerciseToEdit.id : undefined,
        title: title.trim(),
        description: description.trim(),
        class_id: singleClassId,
        is_global: isGlobal,
        grade_level: parseInt(gradeLevel, 10),
        subject: subject,
        exercise_type: exerciseType,
        status: finalStatus,
        reward_stars: parseInt(rewardStars, 10) || 0,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        max_attempts: parseInt(maxAttempts, 10) || 1,
        show_score_after_submit: showScoreAfterSubmit,
        show_correct_answers: showCorrectAnswers
      };

      // 1. Lưu bài tập và các câu hỏi qua RPC save_exercise_with_questions_and_keys
      const { data, error } = await supabase.rpc('save_exercise_with_questions_and_keys', {
        p_exercise: exercisePayload,
        p_questions: questionsPayload
      });

      if (error || !data?.success) {
        setErrorMsg(error?.message || data?.message || 'Lỗi khi lưu bài tập.');
        setIsSubmitting(false);
        return;
      }

      const savedExerciseId = data.exercise_id || exerciseToEdit?.id;

      // 2. Nếu là hành động "Xuất bản & Giao bài" và có lớp được chọn
      let assignedClassNames = [];
      if (submitAction === 'publish_and_assign' && finalStatus === 'published' && targetClassesToAssign.length > 0 && savedExerciseId) {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('assign_exercise_to_classes', {
          p_exercise_id: savedExerciseId,
          p_class_ids: targetClassesToAssign
        });

        if (rpcErr) {
          let userErrMsg = rpcErr.message || 'Lỗi hệ thống khi giao bài.';
          if (userErrMsg.includes('function') || userErrMsg.includes('schema cache') || rpcErr.code === 'PGRST202' || rpcErr.code === 'PGRST205') {
            userErrMsg = '❌ CSDL Supabase chưa nạp RPC [assign_exercise_to_classes]. Vui lòng chạy file CREATE_ACADEMIC_EXERCISE_ASSIGNMENTS_TABLE.sql trong Supabase SQL Editor!';
          }
          setErrorMsg(userErrMsg);
          setIsSubmitting(false);
          return;
        }

        if (!rpcRes || !rpcRes.success) {
          setErrorMsg(rpcRes?.message || 'Không thể giao bài tập cho các lớp được chọn.');
          setIsSubmitting(false);
          return;
        }

        assignedClassNames = rpcRes.assigned_classes || [];
      }

      // Xác định thông báo thành công chuẩn xác theo nghiệp vụ
      let successMsg = '';
      if (submitAction === 'draft') {
        successMsg = 'Đã lưu bản nháp bài tập thành công!';
      } else if (submitAction === 'publish_only') {
        successMsg = isGlobal
          ? 'Đã xuất bản bài tập chung toàn trường thành công!'
          : 'Đã xuất bản bài tập thành công (Chưa giao cho lớp nào).';
      } else {
        successMsg = isGlobal
          ? 'Đã xuất bản bài tập chung toàn trường thành công!'
          : `Đã xuất bản và giao bài cho lớp [${assignedClassNames.join(', ')}] thành công!`;
      }

      onClose(successMsg);
    } catch (err) {
      console.error('Create/Update exercise exception:', err);
      setErrorMsg(err.message || 'Lỗi hệ thống khi lưu bài tập.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4 overflow-hidden">
      <div className="bg-white w-full max-w-[1000px] max-h-[90dvh] rounded-3xl border-4 border-amber-300 shadow-2xl flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-amber-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-900 rounded-2xl border border-amber-300">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">
                {exerciseToEdit ? 'Chỉnh Sửa Bài Tập Học Thuật' : 'Tạo Bài Tập Học Thuật Mới'}
              </h2>
              <p className="text-xs font-bold text-amber-700">Bước {currentStep}/3: Cấu Hình & Giao Bài</p>
            </div>
          </div>
          <button onClick={handleSafeClose} disabled={isSubmitting} className="p-2 bg-slate-100 rounded-2xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div ref={bodyScrollRef} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 bg-slate-50/40 custom-scrollbar">

          {errorMsg && (
            <div className="p-3 bg-rose-50 border-2 border-rose-300 text-rose-900 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-3xl border-2 border-amber-200 shadow-sm space-y-4">
                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    Tiêu Đề Bài Tập <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Ôn tập Toán Khối 1"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    Gán Cho Lớp Học <span className="text-rose-500">*</span>:
                  </label>
                  {profile?.role === 'admin' ? (
                    <div className="p-3 bg-amber-50/60 border-2 border-amber-200 rounded-2xl space-y-2">
                      <p className="text-[11px] font-bold text-amber-900">Admin chọn một hoặc nhiều lớp để giao bài:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto custom-scrollbar">
                        {classesList.map(c => {
                          const isChecked = selectedClassIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              onClick={() => {
                                setSelectedClassIds(prev => 
                                  prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                                );
                              }}
                              className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer ${
                                isChecked ? 'bg-amber-400 text-amber-950 font-black border-amber-500' : 'bg-white text-slate-700 font-bold border-slate-200'
                              }`}
                            >
                              <span>🏫 {formatClassLabel(c.name)}</span>
                              {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-300" />}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <select
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs"
                    >
                      {classesList.map(c => (
                        <option key={c.id} value={c.id}>🏫 {formatClassLabel(c.name)}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-slate-800 mb-1">Môn Học:</label>
                    <select
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs"
                    >
                      <option value="Toán">Toán</option>
                      <option value="Tiếng Việt">Tiếng Việt</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-800 mb-1">Trạng Thái:</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full p-3 bg-amber-50/50 border-2 border-amber-200 rounded-2xl font-bold text-xs"
                    >
                      <option value="draft">Bản nháp (draft)</option>
                      <option value="published">Đã xuất bản (published)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-3 bg-white p-5 rounded-3xl border-2 border-amber-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-800">Danh sách {questions.length} câu hỏi</h3>
                <button type="button" onClick={handleAddQuestion} className="px-3 py-1.5 bg-amber-500 text-white font-black text-xs rounded-xl">
                  + Thêm câu hỏi
                </button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-black text-emerald-900">
              Sẵn sàng xuất bản bài tập với tổng {questions.length} câu hỏi.
            </div>
          )}

        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t-2 border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={handlePrevStep}
            disabled={currentStep === 1 || isSubmitting}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 font-black text-xs rounded-2xl disabled:opacity-40"
          >
            Quay Lại
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={isSubmitting}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs rounded-2xl transition-all"
            >
              Lưu Nháp
            </button>

            <button
              type="button"
              onClick={() => handleSubmit('publish_only')}
              disabled={isSubmitting}
              className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-black text-xs rounded-2xl transition-all"
              title="Xuất bản bài tập nhưng chưa giao cho lớp nào"
            >
              Chỉ Xuất Bản
            </button>

            {currentStep < 3 ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={isSubmitting}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl transition-all"
              >
                Tiếp Tục
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit('publish_and_assign')}
                disabled={isSubmitting}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl shadow-sm transition-all"
              >
                {isSubmitting ? 'Đang Xử Lý...' : 'Xuất Bản & Giao Cho Lớp'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
