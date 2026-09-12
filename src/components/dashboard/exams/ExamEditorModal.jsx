// src/components/dashboard/exams/ExamEditorModal.jsx
// Modal Soạn Thảo Đề Thi Exam Builder V1 (Tạo mới, Lưu nháp, Cấu hình lịch thi linh hoạt & Xuất bản)

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Save,
  Send,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Calendar,
  Layers,
  FileText,
  Loader2,
  HelpCircle,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Info
} from 'lucide-react';
import { createExamManagementClient } from '../../../services/examManagementClient.js';
import { deleteSingleChoiceOption } from './examOptionUtils.js';
import { QuestionBankPickerModal } from './QuestionBankPickerModal.jsx';

export { deleteSingleChoiceOption };

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatDateTimeLocal(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
    return local.toISOString().slice(0, 16);
  } catch (_) {
    return '';
  }
}

const QUESTION_TYPE_LABELS = {
  single_choice: 'Trắc nghiệm 1 đáp án',
  fill_blank: 'Điền khuyết',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận (GV chấm)',
  image_upload: 'Tải ảnh bài làm (GV chấm)',
  file_upload: 'Tải tệp đính kèm (GV chấm)',
};

export const ExamEditorModal = ({
  isOpen,
  onClose,
  examToEdit = null,
  role = 'teacher',
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'schedule' | 'questions' | 'settings'

  // Exam Container & Version Metadata
  const [examId, setExamId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [versionNumber, setVersionNumber] = useState(1);
  const [versionStatus, setVersionStatus] = useState('draft');

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [description, setDescription] = useState('');

  // Flexible Scheduling Phase A
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [startsAt, setStartsAt] = useState('');
  const [lastStartAt, setLastStartAt] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Exam Version Settings
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [rewardStars, setRewardStars] = useState(10);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [tabSwitchPolicy, setTabSwitchPolicy] = useState('WARN_AND_LOG');
  const [showScoreAfterSubmit, setShowScoreAfterSubmit] = useState(true);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);

  // Questions Array
  const [questions, setQuestions] = useState([]);

  // Question Bank Picker Modal State
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [initializingDraft, setInitializingDraft] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3500);
  };

  const [loading, setLoading] = useState(false);
  const [fetchingDetail, setFetchingDetail] = useState(false);
  const [detailLoadStatus, setDetailLoadStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'failed'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setActiveTab('general');

      if (examToEdit) {
        if (examToEdit.active_version?.status === 'published') {
          setErrorMsg('Đề thi đã được xuất bản chính thức và không thể chỉnh sửa.');
          setDetailLoadStatus('failed');
          setFetchingDetail(false);
          return;
        }
        initExistingExam(examToEdit);
      } else {
        initNewExam();
      }
    }
  }, [isOpen, examToEdit]);

  const initNewExam = () => {
    setDetailLoadStatus('ready');
    setFetchingDetail(false);

    setExamId('');
    setVersionId('');
    setVersionNumber(1);
    setVersionStatus('draft');

    setTitle('');
    setSubject('Toán');
    setGradeLevel(1);
    setDescription('');

    setDurationMinutes(45);
    setStartsAt('');
    setLastStartAt('');
    setDueDate('');

    setMaxAttempts(1);
    setRewardStars(10);
    setShuffleQuestions(false);
    setShuffleOptions(false);
    setTabSwitchPolicy('WARN_AND_LOG');
    setShowScoreAfterSubmit(true);
    setShowCorrectAnswers(false);

    setQuestions([
      {
        id: generateUuid(),
        question_number: 1,
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        points: 1,
        options_json: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
          { key: 'C', text: '3' },
          { key: 'D', text: '4' },
        ],
        answer_key: {
          correct_answer: 'B',
        },
      },
    ]);
  };

  const initExistingExam = async (exam) => {
    setDetailLoadStatus('loading');
    setExamId(exam.id);
    setTitle(exam.title || '');
    setSubject(exam.subject || 'Toán');
    setGradeLevel(exam.grade_level || 1);

    const activeV = exam.active_version;
    if (activeV) {
      setVersionId(activeV.id);
      setVersionNumber(activeV.version_number || 1);
      setVersionStatus(activeV.status || 'draft');
      setDescription(activeV.description || '');
      setDurationMinutes(activeV.duration_minutes || 45);
      setStartsAt(formatDateTimeLocal(activeV.starts_at));
      setLastStartAt(formatDateTimeLocal(activeV.last_start_at));
      setDueDate(formatDateTimeLocal(activeV.due_date));
      setMaxAttempts(activeV.max_attempts || 1);
      setRewardStars(activeV.reward_stars || 0);
    }

    // Tải chi tiết câu hỏi từ BFF API
    setFetchingDetail(true);
    try {
      const client = createExamManagementClient();
      const res = await client.getTestDetail({
        examId: exam.id,
        versionId: activeV?.id,
      });

      if (!res.ok || !res.data) {
        setErrorMsg(res.error?.message || 'Không thể tải chi tiết câu hỏi và cấu hình đáp án của đề thi.');
        setQuestions([]);
        setDetailLoadStatus('failed');
        return;
      }

      const v = res.data.version;
      if (v) {
        setVersionId(v.id);
        setVersionNumber(v.version_number || 1);
        setVersionStatus(v.status || 'draft');
        setDescription(v.description || '');
        setDurationMinutes(v.duration_minutes || 45);
        setStartsAt(formatDateTimeLocal(v.starts_at));
        setLastStartAt(formatDateTimeLocal(v.last_start_at));
        setDueDate(formatDateTimeLocal(v.due_date));
        setMaxAttempts(v.max_attempts || 1);
        setRewardStars(v.reward_stars || 0);
        setShuffleQuestions(Boolean(v.shuffle_questions));
        setShuffleOptions(Boolean(v.shuffle_options));
        setTabSwitchPolicy(v.tab_switch_policy || 'WARN_AND_LOG');
        setShowScoreAfterSubmit(v.show_score_after_submit !== undefined ? Boolean(v.show_score_after_submit) : true);
        setShowCorrectAnswers(Boolean(v.show_correct_answers));
      }

      const rawQuestions = res.data.questions || [];
      if (rawQuestions.length > 0) {
        setQuestions(
          rawQuestions.map((q, idx) => {
            let normalizedOptions = [];
            if (Array.isArray(q.options_json)) {
              normalizedOptions = q.options_json.map((opt, optIdx) => {
                if (typeof opt === 'object' && opt !== null && opt.key && opt.text !== undefined) {
                  return { key: String(opt.key), text: String(opt.text) };
                }
                const fallbackKey = String.fromCharCode(65 + optIdx);
                return { key: fallbackKey, text: String(opt ?? '') };
              });
            }

            let normalizedAnswerKey = q.answer_key || null;
            if (q.question_type === 'single_choice' && normalizedAnswerKey?.correct_answer) {
              const currentAns = String(normalizedAnswerKey.correct_answer);
              const existsByKey = normalizedOptions.some((o) => o.key === currentAns);
              if (!existsByKey) {
                const matchByText = normalizedOptions.find((o) => o.text === currentAns);
                if (matchByText) {
                  normalizedAnswerKey = { ...normalizedAnswerKey, correct_answer: matchByText.key };
                }
              }
            } else if (q.question_type === 'multiple_choice' && normalizedAnswerKey?.correct_answer) {
              const currentAnsList = Array.isArray(normalizedAnswerKey.correct_answer)
                ? normalizedAnswerKey.correct_answer
                : [normalizedAnswerKey.correct_answer];
              const mapped = currentAnsList.map((ans) => {
                const strAns = String(ans);
                const existsByKey = normalizedOptions.some((o) => o.key === strAns);
                if (existsByKey) return strAns;
                const matchByText = normalizedOptions.find((o) => o.text === strAns);
                return matchByText ? matchByText.key : strAns;
              });
              normalizedAnswerKey = { ...normalizedAnswerKey, correct_answer: mapped };
            }

            return {
              id: q.id || generateUuid(),
              question_number: q.question_number || idx + 1,
              question_type: q.question_type || 'single_choice',
              prompt: q.prompt || '',
              points: Number(q.points) || 1,
              options_json: normalizedOptions,
              answer_key: normalizedAnswerKey,
            };
          })
        );
      } else {
        setQuestions([]);
      }
      setDetailLoadStatus('ready');
    } catch (err) {
      console.error('Fetch test detail exception:', err);
      setErrorMsg(err?.message || 'Lỗi hệ thống khi tải chi tiết đề thi.');
      setQuestions([]);
      setDetailLoadStatus('failed');
    } finally {
      setFetchingDetail(false);
    }
  };

  // Thêm câu hỏi mới
  const handleAddQuestion = (type = 'single_choice') => {
    if (Boolean(examToEdit) && detailLoadStatus !== 'ready') {
      return;
    }

    const nextNum = questions.length + 1;
    let initialOptions = [];
    let initialAnswerKey = null;

    if (type === 'single_choice') {
      initialOptions = [
        { key: 'A', text: 'Lựa chọn 1' },
        { key: 'B', text: 'Lựa chọn 2' },
        { key: 'C', text: 'Lựa chọn 3' },
        { key: 'D', text: 'Lựa chọn 4' },
      ];
      initialAnswerKey = { correct_answer: 'A' };
    } else if (type === 'multiple_choice') {
      initialOptions = [
        { key: 'A', text: 'Lựa chọn 1' },
        { key: 'B', text: 'Lựa chọn 2' },
        { key: 'C', text: 'Lựa chọn 3' },
        { key: 'D', text: 'Lựa chọn 4' },
      ];
      initialAnswerKey = { correct_answer: ['A'] };
    } else if (type === 'fill_blank' || type === 'short_answer') {
      initialAnswerKey = { correct_answer: '' };
    }

    const newQ = {
      id: generateUuid(),
      question_number: nextNum,
      question_type: type,
      prompt: '',
      points: 1,
      options_json: initialOptions,
      answer_key: initialAnswerKey,
    };

    setQuestions([...questions, newQ]);
  };

  // Mở Question Bank Picker: đảm bảo đã có bản nháp trên cơ sở dữ liệu trước khi chọn câu hỏi
  const handleOpenQuestionBankPicker = async () => {
    if (examToEdit?.active_version?.status === 'published') return;
    if (Boolean(examToEdit) && detailLoadStatus !== 'ready') return;

    // Nếu đã có examId & versionId (đang chỉnh sửa hoặc đã khởi tạo draft trước đó): mở picker trực tiếp
    if (examId && versionId) {
      setIsPickerOpen(true);
      return;
    }

    // Nếu là đề thi mới chưa lưu DB: tự động tạo draft container trước
    setInitializingDraft(true);
    setErrorMsg('');
    try {
      const client = createExamManagementClient();
      const createRes = await client.createTest({
        title: title.trim() || 'Đề thi mới',
        subject: subject.trim() || 'Toán',
        grade_level: Number(gradeLevel) || 1,
        description: description.trim() || null,
      });

      if (!createRes.ok || !createRes.data) {
        setErrorMsg(createRes.error?.message || 'Không thể khởi tạo bản nháp đề thi.');
        return;
      }

      setExamId(createRes.data.exam_id);
      setVersionId(createRes.data.version_id);
      setVersionNumber(createRes.data.version_number || 1);
      setVersionStatus('draft');

      setIsPickerOpen(true);
    } catch (err) {
      console.error('[ExamEditorModal] Lỗi khởi tạo draft container khi mở QB picker:', err);
      setErrorMsg(err?.message || 'Có lỗi xảy ra khi chuẩn bị bản nháp đề thi.');
    } finally {
      setInitializingDraft(false);
    }
  };

  // Nhập danh sách câu hỏi từ Question Bank Picker
  const handleImportFromQuestionBank = async (selectedItemIds, selectedItems) => {
    if (!Array.isArray(selectedItemIds) || selectedItemIds.length === 0) return;

    if (Boolean(examToEdit) && detailLoadStatus !== 'ready') {
      throw new Error('Chưa tải xong dữ liệu gốc của đề thi.');
    }

    try {
      const client = createExamManagementClient();
      let currentVerId = versionId;
      let currentExamId = examId;

      // Fallback an toàn: nếu chưa có exam_id hoặc version_id trên DB: gọi createTest trước
      if (!currentExamId || !currentVerId) {
        const createRes = await client.createTest({
          title: title.trim() || 'Đề thi mới',
          subject: subject.trim() || 'Toán',
          grade_level: Number(gradeLevel) || 1,
          description: description.trim() || null,
        });

        if (!createRes.ok || !createRes.data) {
          throw new Error(createRes.error?.message || 'Không thể khởi tạo bản nháp đề thi.');
        }

        currentExamId = createRes.data.exam_id;
        currentVerId = createRes.data.version_id;
        setExamId(currentExamId);
        setVersionId(currentVerId);
        setVersionStatus('draft');
      }

      // Gọi endpoint BFF nhập câu hỏi và lưu Snapshot an toàn trên server
      const res = await client.importQuestionsFromQuestionBank({
        versionId: currentVerId,
        examId: currentExamId,
        questionBankItemIds: selectedItemIds,
      });

      if (!res.ok || !res.data) {
        throw new Error(res.error?.message || 'Không thể nhập câu hỏi từ Ngân hàng câu hỏi.');
      }

      const imported = res.data.imported_questions || [];
      if (imported.length === 0) {
        throw new Error('Không có câu hỏi nào được nhập.');
      }

      // Tải lại chi tiết đề thi bản nháp cho tác giả qua RPC Authoring an toàn
      const detailRes = await client.getTestDetail({
        examId: currentExamId,
        versionId: currentVerId,
      });

      if (detailRes.ok && detailRes.data?.questions) {
        setQuestions(
          detailRes.data.questions.map((q, idx) => ({
            id: q.id || generateUuid(),
            question_number: q.question_number || idx + 1,
            question_type: q.question_type || 'single_choice',
            prompt: q.prompt || '',
            points: Number(q.points) || 1,
            options_json: Array.isArray(q.options_json)
              ? q.options_json.map((opt, optIdx) => ({
                  key: typeof opt === 'object' && opt !== null ? opt.key : String.fromCharCode(65 + optIdx),
                  text: typeof opt === 'object' && opt !== null ? opt.text : String(opt ?? ''),
                }))
              : [],
            answer_key: q.answer_key || null,
            source_question_bank_item_id: q.source_question_bank_item_id || null,
            source_question_bank_version_id: q.source_question_bank_version_id || null,
          }))
        );
      } else {
        // Fallback cập nhật danh sách an toàn
        setQuestions(prevQuestions => {
          const isDefaultDummy = prevQuestions.length === 1 && prevQuestions[0].prompt === '1 + 1 = ?' && !examToEdit;
          const baseQuestions = isDefaultDummy ? [] : prevQuestions;
          const startNum = baseQuestions.length;
          const mapped = imported.map((q, idx) => ({
            ...q,
            question_number: startNum + idx + 1,
          }));
          return [...baseQuestions, ...mapped];
        });
      }

      showToast(`Đã thêm thành công ${imported.length} câu hỏi từ Ngân hàng câu hỏi vào đề thi.`);
      setActiveTab('questions');
    } catch (err) {
      console.error('[ExamEditorModal] Lỗi nhập câu hỏi từ Ngân hàng:', err);
      throw err;
    }
  };

  const handleDeleteQuestion = (qIndex) => {
    if (Boolean(examToEdit) && detailLoadStatus !== 'ready') {
      return;
    }
    if (questions.length <= 1) {
      alert('Đề thi phải có ít nhất 1 câu hỏi.');
      return;
    }
    const filtered = questions.filter((_, idx) => idx !== qIndex);
    // Cập nhật lại question_number
    const renumbered = filtered.map((q, idx) => ({
      ...q,
      question_number: idx + 1,
    }));
    setQuestions(renumbered);
  };

  const handleUpdateQuestion = (qIndex, field, value) => {
    if (Boolean(examToEdit) && detailLoadStatus !== 'ready') {
      return;
    }
    const updated = [...questions];
    let q = { ...updated[qIndex] };

    if (field === 'question_type') {
      q.question_type = value;
      if (value === 'single_choice') {
        if (!Array.isArray(q.options_json) || q.options_json.length < 2) {
          q.options_json = [
            { key: 'A', text: 'Lựa chọn 1' },
            { key: 'B', text: 'Lựa chọn 2' },
            { key: 'C', text: 'Lựa chọn 3' },
            { key: 'D', text: 'Lựa chọn 4' },
          ];
        } else {
          q.options_json = q.options_json.map((opt, idx) => ({
            key: typeof opt === 'object' && opt !== null ? opt.key : String.fromCharCode(65 + idx),
            text: typeof opt === 'object' && opt !== null ? opt.text : String(opt ?? ''),
          }));
        }
        const firstKey = q.options_json[0]?.key || 'A';
        const currentAns = typeof q.answer_key?.correct_answer === 'string' ? q.answer_key.correct_answer : firstKey;
        const validKey = q.options_json.some((o) => o.key === currentAns) ? currentAns : firstKey;
        q.answer_key = { correct_answer: validKey };
      } else if (value === 'multiple_choice') {
        if (!Array.isArray(q.options_json) || q.options_json.length < 2) {
          q.options_json = [
            { key: 'A', text: 'Lựa chọn 1' },
            { key: 'B', text: 'Lựa chọn 2' },
            { key: 'C', text: 'Lựa chọn 3' },
            { key: 'D', text: 'Lựa chọn 4' },
          ];
        } else {
          q.options_json = q.options_json.map((opt, idx) => ({
            key: typeof opt === 'object' && opt !== null ? opt.key : String.fromCharCode(65 + idx),
            text: typeof opt === 'object' && opt !== null ? opt.text : String(opt ?? ''),
          }));
        }
        const firstKey = q.options_json[0]?.key || 'A';
        const currentAns = Array.isArray(q.answer_key?.correct_answer)
          ? q.answer_key.correct_answer.filter((k) => q.options_json.some((o) => o.key === k))
          : [firstKey];
        q.answer_key = { correct_answer: currentAns.length > 0 ? currentAns : [firstKey] };
      } else if (['fill_blank', 'short_answer'].includes(value)) {
        q.options_json = [];
        q.answer_key = {
          correct_answer: typeof q.answer_key?.correct_answer === 'string' ? q.answer_key.correct_answer : '',
        };
      } else {
        q.options_json = [];
        q.answer_key = null;
      }
    } else {
      q[field] = value;
    }

    updated[qIndex] = q;
    setQuestions(updated);
  };

  // Lưu bản nháp (hoặc tạo mới nếu chưa có)
  const handleSaveDraft = async (shouldPublishAfter = false) => {
    if (isPublished) {
      setErrorMsg('Đề thi đã được xuất bản chính thức và không thể chỉnh sửa.');
      return;
    }

    // Invariant Guard: Fail-closed if existing exam detail is not ready or failed
    if (Boolean(examToEdit) && detailLoadStatus !== 'ready') {
      setErrorMsg('Không thể lưu hoặc xuất bản đề thi khi chưa tải hoàn tất dữ liệu gốc từ máy chủ. Vui lòng đóng và mở lại.');
      return;
    }

    if (!title.trim()) {
      setErrorMsg('Vui lòng nhập tiêu đề đề thi.');
      setActiveTab('general');
      return;
    }

    if (!subject.trim()) {
      setErrorMsg('Vui lòng chọn môn học.');
      setActiveTab('general');
      return;
    }

    if (questions.length === 0) {
      setErrorMsg('Đề thi phải có ít nhất 1 câu hỏi.');
      setActiveTab('questions');
      return;
    }

    // Kiểm tra câu hỏi
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt?.trim()) {
        setErrorMsg(`Vui lòng nhập nội dung câu hỏi số ${i + 1}.`);
        setActiveTab('questions');
        return;
      }
      if (q.question_type === 'single_choice') {
        if (!Array.isArray(q.options_json) || q.options_json.length < 2) {
          setErrorMsg(`Câu hỏi số ${i + 1} (Trắc nghiệm 1 đáp án) phải có ít nhất 2 lựa chọn đáp án.`);
          setActiveTab('questions');
          return;
        }
        for (let oi = 0; oi < q.options_json.length; oi++) {
          const opt = q.options_json[oi];
          const optText = typeof opt === 'object' && opt !== null ? opt.text : String(opt ?? '');
          if (!optText || !optText.trim()) {
            setErrorMsg(`Vui lòng nhập nội dung cho lựa chọn ${oi + 1} của câu hỏi số ${i + 1}.`);
            setActiveTab('questions');
            return;
          }
        }
        if (!q.answer_key || !q.answer_key.correct_answer) {
          setErrorMsg(`Vui lòng chọn đáp án đúng cho câu hỏi số ${i + 1}.`);
          setActiveTab('questions');
          return;
        }
      } else if (q.question_type === 'multiple_choice') {
        if (!Array.isArray(q.options_json) || q.options_json.length < 2) {
          setErrorMsg(`Câu hỏi số ${i + 1} (Trắc nghiệm nhiều đáp án) phải có ít nhất 2 lựa chọn đáp án.`);
          setActiveTab('questions');
          return;
        }
        for (let oi = 0; oi < q.options_json.length; oi++) {
          const opt = q.options_json[oi];
          const optText = typeof opt === 'object' && opt !== null ? opt.text : String(opt ?? '');
          if (!optText || !optText.trim()) {
            setErrorMsg(`Vui lòng nhập nội dung cho lựa chọn ${oi + 1} của câu hỏi số ${i + 1}.`);
            setActiveTab('questions');
            return;
          }
        }
        if (!q.answer_key || !Array.isArray(q.answer_key.correct_answer) || q.answer_key.correct_answer.length === 0) {
          setErrorMsg(`Vui lòng chọn ít nhất một đáp án đúng cho câu hỏi số ${i + 1}.`);
          setActiveTab('questions');
          return;
        }
      } else if (['fill_blank', 'short_answer'].includes(q.question_type)) {
        if (!q.answer_key || q.answer_key.correct_answer === undefined || q.answer_key.correct_answer === '') {
          setErrorMsg(`Vui lòng cấu hình đáp án đúng cho câu hỏi số ${i + 1} (${QUESTION_TYPE_LABELS[q.question_type]}).`);
          setActiveTab('questions');
          return;
        }
      }
    }

    // Kiểm tra lịch thi
    if (startsAt && lastStartAt && new Date(lastStartAt).getTime() < new Date(startsAt).getTime()) {
      setErrorMsg('Hạn chót vào làm bài không thể sớm hơn thời gian mở đề.');
      setActiveTab('schedule');
      return;
    }
    if (lastStartAt && dueDate && new Date(lastStartAt).getTime() > new Date(dueDate).getTime()) {
      setErrorMsg('Hạn chót vào làm bài không thể muộn hơn hạn nộp bài cưỡng chế.');
      setActiveTab('schedule');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const client = createExamManagementClient();
      let currentVerId = versionId;

      // Nếu chưa có đề thi (tạo mới từ đầu): gọi createTest trước
      if (!examId || !currentVerId) {
        const createRes = await client.createTest({
          title: title.trim(),
          subject: subject.trim(),
          grade_level: Number(gradeLevel),
          description: description?.trim() || null,
        });

        if (!createRes.ok || !createRes.data) {
          setErrorMsg(createRes.error?.message || 'Không thể khởi tạo đề thi.');
          setLoading(false);
          return;
        }

        setExamId(createRes.data.exam_id);
        currentVerId = createRes.data.version_id;
        setVersionId(currentVerId);
      }

      // Chuẩn bị payload lưu nháp với canonical options schema [{key, text}]
      const savePayload = {
        version_id: currentVerId,
        title: title.trim(),
        subject: subject.trim(),
        grade_level: Number(gradeLevel),
        description: description?.trim() || null,
        duration_minutes: durationMinutes ? Number(durationMinutes) : null,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        last_start_at: lastStartAt ? new Date(lastStartAt).toISOString() : null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        max_attempts: Number(maxAttempts) || 1,
        reward_stars: Number(rewardStars) || 0,
        shuffle_questions: Boolean(shuffleQuestions),
        shuffle_options: Boolean(shuffleOptions),
        tab_switch_policy: tabSwitchPolicy,
        show_score_after_submit: Boolean(showScoreAfterSubmit),
        show_correct_answers: Boolean(showCorrectAnswers),
        questions: questions.map((q, idx) => {
          let canonicalOptions = [];
          if (['single_choice', 'multiple_choice'].includes(q.question_type)) {
            canonicalOptions = (Array.isArray(q.options_json) ? q.options_json : []).map((opt, oIdx) => {
              if (typeof opt === 'object' && opt !== null && opt.key) {
                return { key: String(opt.key).trim(), text: String(opt.text ?? '').trim() };
              }
              return { key: String.fromCharCode(65 + oIdx), text: String(opt ?? '').trim() };
            });
          }

          let answerKey = null;
          if (q.question_type === 'single_choice') {
            answerKey = {
              correct_answer: String(q.answer_key?.correct_answer || canonicalOptions[0]?.key || 'A').trim(),
            };
          } else if (q.question_type === 'multiple_choice') {
            const rawAns = q.answer_key?.correct_answer;
            const ansArray = Array.isArray(rawAns) ? rawAns : [String(rawAns || 'A')];
            answerKey = {
              correct_answer: ansArray.map((a) => String(a).trim()),
            };
          } else if (['fill_blank', 'short_answer'].includes(q.question_type)) {
            answerKey = {
              correct_answer: String(q.answer_key?.correct_answer || '').trim(),
            };
          }

          return {
            id: q.id || generateUuid(),
            question_number: idx + 1,
            question_type: q.question_type,
            prompt: q.prompt.trim(),
            points: Number(q.points) || 1,
            options_json: canonicalOptions,
            answer_key: answerKey,
          };
        }),
      };

      const saveRes = await client.saveDraft(savePayload);
      if (!saveRes.ok) {
        setErrorMsg(saveRes.error?.message || 'Lỗi khi lưu bản nháp đề thi.');
        setLoading(false);
        return;
      }

      // Nếu người dùng chọn Xuất bản: gọi publish
      if (shouldPublishAfter) {
        const pubRes = await client.publishVersion({ version_id: currentVerId });
        if (!pubRes.ok) {
          setErrorMsg(pubRes.error?.message || 'Lỗi khi xuất bản đề thi.');
          setLoading(false);
          return;
        }
        if (typeof onSaved === 'function') {
          onSaved();
        }
        onClose('🎉 Đã xuất bản đề thi thành công! Thầy/Cô có thể giao cho lớp học ngay bây giờ.');
        return;
      }

      if (typeof onSaved === 'function') {
        onSaved();
      }
      onClose('✅ Đã lưu bản nháp đề thi thành công!');
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi hệ thống khi lưu đề thi.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const isPublished = versionStatus === 'published';

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      <div className="bg-white w-full max-w-5xl h-[92vh] max-h-[92vh] rounded-3xl border-4 border-amber-300 shadow-2xl flex flex-col overflow-hidden animate-fadeIn">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b-2 border-amber-100 bg-amber-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-md">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-800">
                  {examToEdit ? 'Chỉnh Sửa Đề Kiểm Tra' : 'Tạo Mới Đề Kiểm Tra V1'}
                </h3>
                {versionId && (
                  <span
                    className={`px-2 py-0.5 text-[10px] font-black rounded-md uppercase ${
                      isPublished
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}
                  >
                    {isPublished ? `v${versionNumber} Đã Xuất Bản` : `v${versionNumber} Bản Nháp`}
                  </span>
                )}
              </div>
              <p className="text-xs font-bold text-amber-800">Soạn đề thi & Cấu hình lịch thi linh hoạt</p>
            </div>
          </div>

          <button
            onClick={() => onClose()}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 shrink-0 gap-2 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2.5 font-black text-xs rounded-t-xl transition-all ${
              activeTab === 'general'
                ? 'bg-white text-indigo-700 border-t-2 border-x border-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            1. Thông Tin Chung
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`px-4 py-2.5 font-black text-xs rounded-t-xl transition-all ${
              activeTab === 'schedule'
                ? 'bg-white text-indigo-700 border-t-2 border-x border-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            2. Lịch Thi & Thời Lượng
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('questions')}
            className={`px-4 py-2.5 font-black text-xs rounded-t-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'questions'
                ? 'bg-white text-indigo-700 border-t-2 border-x border-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            3. Danh Sách Câu Hỏi ({questions.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2.5 font-black text-xs rounded-t-xl transition-all ${
              activeTab === 'settings'
                ? 'bg-white text-indigo-700 border-t-2 border-x border-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            4. Cài Đặt Phòng Thi
          </button>
        </div>

        {/* BODY CONTENT */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-slate-50/40 custom-scrollbar space-y-5">
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {Boolean(examToEdit) && detailLoadStatus === 'failed' && (
            <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl flex items-start gap-3 text-rose-900 shadow-sm">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h5 className="text-xs font-black uppercase text-rose-900">
                  Lỗi Tải Dữ Liệu Đề Thi (Khóa An Toàn / Fail-Closed)
                </h5>
                <p className="text-xs font-bold text-rose-700">
                  Không thể tải đầy đủ danh sách câu hỏi và cấu hình đáp án từ máy chủ. Để đảm bảo không ghi đè dữ liệu rỗng lên đề thi hiện có, tính năng Lưu nháp và Xuất bản đã bị khóa hoàn toàn. Vui lòng đóng cửa sổ này và thử lại.
                </p>
              </div>
            </div>
          )}

          {isPublished && (
            <div className="p-3.5 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-2xl text-xs font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Đề thi đã được xuất bản chính thức. Phiên bản này ở trạng thái bất biến và không thể chỉnh sửa trực tiếp.
              </span>
            </div>
          )}

          {fetchingDetail ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-500">Đang tải dữ liệu câu hỏi đề thi...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: THÔNG TIN CHUNG */}
              {activeTab === 'general' && (
                <div className="space-y-4 max-w-3xl">
                  <div className="bg-white p-5 rounded-3xl border-2 border-slate-200 shadow-sm space-y-4">
                    <div>
                      <label className="block text-xs font-black text-slate-800 mb-1">
                        Tiêu Đề Đề Thi <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Ví dụ: Đề Kiểm Tra Định Kỳ Môn Toán Khối 1"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full p-3 bg-amber-50/40 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Môn Học <span className="text-rose-500">*</span>
                        </label>
                        <select
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="Toán">Toán</option>
                          <option value="Tiếng Việt">Tiếng Việt</option>
                          <option value="Tiếng Anh">Tiếng Anh</option>
                          <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
                          <option value="Khoa học">Khoa học</option>
                          <option value="Lịch sử & Địa lý">Lịch sử & Địa lý</option>
                          <option value="Tin học">Tin học</option>
                          <option value="Đạo đức">Đạo đức</option>
                          <option value="Khác">Môn khác</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Khối Lớp <span className="text-rose-500">*</span>
                        </label>
                        <select
                          value={gradeLevel}
                          onChange={(e) => setGradeLevel(Number(e.target.value))}
                          className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                            <option key={g} value={g}>
                              Khối {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-black text-slate-800 mb-1">
                        Mô Tả / Lời Dặn Dò Học Sinh:
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Ví dụ: Học sinh đọc kỹ đề, chuẩn bị giấy nháp, không sử dụng tài liệu ngoài..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: LỊCH THI LINH HOẠT (PHASE A) */}
              {activeTab === 'schedule' && (
                <div className="space-y-4 max-w-3xl">
                  <div className="bg-white p-5 rounded-3xl border-2 border-indigo-200 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-indigo-950 uppercase flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-600" /> Cấu hình lịch thi 4 trường (Flexible Scheduling)
                    </h4>

                    <div>
                      <label className="block text-xs font-black text-slate-800 mb-1 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-amber-500" />
                        Thời lượng làm bài (duration_minutes) <span className="text-rose-500">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={300}
                          value={durationMinutes || ''}
                          onChange={(e) => setDurationMinutes(e.target.value ? Number(e.target.value) : '')}
                          className="w-32 p-3 bg-amber-50/40 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
                        />
                        <span className="text-xs font-bold text-slate-600">phút (Đồng hồ đếm ngược khi học sinh làm bài)</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Thời gian mở đề (starts_at):
                        </label>
                        <input
                          type="datetime-local"
                          value={startsAt}
                          onChange={(e) => setStartsAt(e.target.value)}
                          className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-[11px] font-bold text-slate-400 mt-1">
                          Học sinh không thể bắt đầu làm bài trước thời điểm này.
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Hạn chót vào làm bài (last_start_at):
                        </label>
                        <input
                          type="datetime-local"
                          value={lastStartAt}
                          onChange={(e) => setLastStartAt(e.target.value)}
                          className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-[11px] font-bold text-slate-400 mt-1">
                          Sau mốc này, học sinh chưa bấm bắt đầu sẽ bị khóa đề.
                        </p>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Hạn nộp bài cưỡng chế (due_date):
                        </label>
                        <input
                          type="datetime-local"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                          className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-[11px] font-bold text-slate-400 mt-1">
                          Đóng phòng thi toàn diện: cắt giờ và thu bài ngay lập tức khi đến hạn này.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: SOẠN CÂU HỎI */}
              {activeTab === 'questions' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-black text-slate-800">
                        Danh Sách Câu Hỏi ({questions.length})
                      </h4>
                      <p className="text-xs font-bold text-slate-400">
                        Tổng điểm đề thi:{' '}
                        <strong className="text-indigo-600">
                          {questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0).toFixed(2)} điểm
                        </strong>
                      </p>
                    </div>

                    {/* NÚT THÊM CÂU HỎI */}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={handleOpenQuestionBankPicker}
                        disabled={initializingDraft || loading || fetchingDetail || (Boolean(examToEdit) && detailLoadStatus !== 'ready')}
                        className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-black rounded-xl shadow-md flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        title="Chọn và lấy câu hỏi từ Ngân hàng câu hỏi"
                      >
                        {initializingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5 text-indigo-200" />}
                        <span>{initializingDraft ? 'Đang khởi tạo...' : 'Lấy từ Ngân hàng'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion('single_choice')}
                        disabled={Boolean(examToEdit) && detailLoadStatus !== 'ready'}
                        className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl shadow flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Trắc nghiệm
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion('essay')}
                        disabled={Boolean(examToEdit) && detailLoadStatus !== 'ready'}
                        className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black rounded-xl shadow flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Tự luận
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddQuestion('fill_blank')}
                        disabled={Boolean(examToEdit) && detailLoadStatus !== 'ready'}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Điền từ
                      </button>
                    </div>
                  </div>

                  {/* DANH SÁCH THẺ CÂU HỎI */}
                  <div className="space-y-4">
                    {questions.map((q, qIndex) => (
                      <div
                        key={q.id || qIndex}
                        className="bg-white p-5 rounded-3xl border-2 border-slate-200 shadow-sm space-y-3"
                      >
                        {/* HEADER CÂU HỎI */}
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 bg-indigo-100 text-indigo-800 rounded-xl font-black text-xs flex items-center justify-center">
                              {qIndex + 1}
                            </span>
                            <select
                              value={q.question_type}
                              onChange={(e) => handleUpdateQuestion(qIndex, 'question_type', e.target.value)}
                              className="p-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
                            >
                              {Object.entries(QUESTION_TYPE_LABELS).map(([k, label]) => (
                                <option key={k} value={k}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                              <span>Điểm:</span>
                              <input
                                type="number"
                                step="0.25"
                                min="0.1"
                                max="100"
                                value={q.points || 1}
                                onChange={(e) => handleUpdateQuestion(qIndex, 'points', Number(e.target.value))}
                                className="w-16 p-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-center"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDeleteQuestion(qIndex)}
                              className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                              title="Xóa câu hỏi"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* NỘI DUNG CÂU HỎI */}
                        <div>
                          <label className="block text-[11px] font-black text-slate-700 mb-1">
                            Nội dung câu hỏi:
                          </label>
                          <textarea
                            rows={2}
                            placeholder="Nhập nội dung câu hỏi..."
                            value={q.prompt}
                            onChange={(e) => handleUpdateQuestion(qIndex, 'prompt', e.target.value)}
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-400"
                          />
                        </div>

                        {/* SOẠN ĐÁP ÁN TRẮC NGHIỆM 1 ĐÁP ÁN */}
                        {q.question_type === 'single_choice' && (
                          <div className="space-y-2 pt-1">
                            <label className="block text-[11px] font-black text-slate-700">
                              Các lựa chọn & Đáp án đúng (Bấm chọn chữ cái A/B/C... để đặt làm đáp án đúng):
                            </label>
                            {(q.options_json || []).map((opt, optIdx) => {
                              const optKey = typeof opt === 'object' && opt !== null ? opt.key : String.fromCharCode(65 + optIdx);
                              const optText = typeof opt === 'object' && opt !== null ? opt.text : String(opt ?? '');
                              const isCorrect = q.answer_key?.correct_answer === optKey;
                              return (
                                <div key={optKey || optIdx} className="flex items-center gap-2">
                                  <label
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-xl cursor-pointer border-2 transition-all shrink-0 ${
                                      isCorrect
                                        ? 'bg-emerald-500 border-emerald-600 text-white shadow-sm font-black'
                                        : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200 font-bold'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`correct_radio_${q.id}`}
                                      checked={isCorrect}
                                      onChange={() =>
                                        handleUpdateQuestion(qIndex, 'answer_key', {
                                          correct_answer: optKey,
                                        })
                                      }
                                      className="sr-only"
                                    />
                                    <span className="text-xs">{optKey}</span>
                                    {isCorrect && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                  </label>
                                  <input
                                    type="text"
                                    placeholder={`Nội dung lựa chọn ${optKey}...`}
                                    value={optText}
                                    onChange={(e) => {
                                      const newOpts = [...q.options_json].map((item, i) => {
                                        const k = typeof item === 'object' && item !== null ? item.key : String.fromCharCode(65 + i);
                                        const t = typeof item === 'object' && item !== null ? item.text : String(item ?? '');
                                        return { key: k, text: i === optIdx ? e.target.value : t };
                                      });
                                      handleUpdateQuestion(qIndex, 'options_json', newOpts);
                                    }}
                                    className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (q.options_json.length <= 2) return;
                                      const { options: newOpts, correctKey: newCorrect } = deleteSingleChoiceOption(
                                        q.options_json,
                                        q.answer_key?.correct_answer,
                                        optIdx
                                      );
                                      handleUpdateQuestion(qIndex, 'options_json', newOpts);
                                      handleUpdateQuestion(qIndex, 'answer_key', { correct_answer: newCorrect });
                                    }}
                                    className="p-1 text-slate-400 hover:text-rose-500"
                                    title="Xóa lựa chọn này"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}

                            <button
                              type="button"
                              onClick={() => {
                                const currentOpts = Array.isArray(q.options_json) ? q.options_json : [];
                                const nextIdx = currentOpts.length;
                                const nextKey = String.fromCharCode(65 + nextIdx);
                                const nextOpt = { key: nextKey, text: `Lựa chọn ${nextIdx + 1}` };
                                const newOpts = [
                                  ...currentOpts.map((item, i) => ({
                                    key: typeof item === 'object' && item !== null ? item.key : String.fromCharCode(65 + i),
                                    text: typeof item === 'object' && item !== null ? item.text : String(item ?? ''),
                                  })),
                                  nextOpt,
                                ];
                                handleUpdateQuestion(qIndex, 'options_json', newOpts);
                              }}
                              className="text-xs font-bold text-indigo-600 hover:underline pt-1"
                            >
                              + Thêm lựa chọn
                            </button>
                          </div>
                        )}

                        {/* SOẠN ĐIỀN TỪ / TRẢ LỜI NGẮN */}
                        {(q.question_type === 'fill_blank' || q.question_type === 'short_answer') && (
                          <div className="pt-1">
                            <label className="block text-[11px] font-black text-slate-700 mb-1">
                              Đáp án đúng chính xác:
                            </label>
                            <input
                              type="text"
                              placeholder="Nhập đáp án chuẩn để hệ thống tự động chấm..."
                              value={q.answer_key?.correct_answer || ''}
                              onChange={(e) =>
                                handleUpdateQuestion(qIndex, 'answer_key', {
                                  correct_answer: e.target.value,
                                })
                              }
                              className="w-full p-2.5 bg-emerald-50/50 border border-emerald-300 rounded-xl font-bold text-xs text-slate-800"
                            />
                          </div>
                        )}

                        {/* TỰ LUẬN / TẢI TỆP */}
                        {['essay', 'image_upload', 'file_upload'].includes(q.question_type) && (
                          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs font-bold text-amber-900">
                            ℹ️ Câu hỏi dạng này sẽ do Giáo viên chấm điểm và nhận xét thủ công sau khi học sinh nộp bài.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: CÀI ĐẶT PHÒNG THI */}
              {activeTab === 'settings' && (
                <div className="space-y-4 max-w-3xl">
                  <div className="bg-white p-5 rounded-3xl border-2 border-slate-200 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-slate-800 uppercase">Tùy Chọn Bảo Mật & Phòng Thi</h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Số lượt làm bài tối đa (max_attempts):
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={maxAttempts}
                          onChange={(e) => setMaxAttempts(Number(e.target.value))}
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-800 mb-1">
                          Sao thưởng khi hoàn thành (reward_stars):
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={rewardStars}
                          onChange={(e) => setRewardStars(Number(e.target.value))}
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-800"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shuffleQuestions}
                          onChange={(e) => setShuffleQuestions(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span className="text-xs font-bold text-slate-700">Trộn ngẫu nhiên thứ tự câu hỏi cho từng học sinh</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shuffleOptions}
                          onChange={(e) => setShuffleOptions(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span className="text-xs font-bold text-slate-700">Trộn ngẫu nhiên thứ tự các đáp án A/B/C/D</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showScoreAfterSubmit}
                          onChange={(e) => setShowScoreAfterSubmit(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span className="text-xs font-bold text-slate-700">Hiển thị điểm số ngay sau khi học sinh nộp bài</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showCorrectAnswers}
                          onChange={(e) => setShowCorrectAnswers(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span className="text-xs font-bold text-slate-700">Hiển thị đáp án đúng sau khi kết thúc đợt thi</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-white shrink-0">
          <button
            type="button"
            onClick={() => onClose()}
            disabled={loading}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-all"
          >
            Đóng
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSaveDraft(false)}
              disabled={loading || fetchingDetail || (Boolean(examToEdit) && detailLoadStatus !== 'ready')}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md border-b-4 border-amber-700 flex items-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Lưu Bản Nháp
            </button>

            <button
              type="button"
              onClick={() => handleSaveDraft(true)}
              disabled={loading || fetchingDetail || (Boolean(examToEdit) && detailLoadStatus !== 'ready')}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md border-b-4 border-emerald-800 flex items-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Xuất Bản Đề Thi
            </button>
          </div>
        </div>

        {/* QUESTION BANK PICKER MODAL */}
        <QuestionBankPickerModal
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onImportQuestions={handleImportFromQuestionBank}
          existingQuestions={questions}
          defaultSubject={subject}
          defaultGrade={gradeLevel}
          role={role}
        />

        {/* TOAST NOTIFICATION */}
        {toastMsg && (
          <div className="fixed top-6 right-6 z-[100] bg-emerald-700 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-500 animate-in fade-in slide-in-from-top-4 duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
            <span className="text-sm font-bold">{toastMsg}</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

