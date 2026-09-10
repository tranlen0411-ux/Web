// src/components/dashboard/exams/ExamTakingModal.jsx
// Exam Builder V1 - Phase 3E Frontend Exam Taking Modal
// Complete UI Foundation using ExamTakingSession & useExamIntegrity
// Pure RAM state only, zero persistent browser storage,
// strictly no auto-submit on expiry, advisory countdown only, upload features disabled.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Send,
  Save,
  X,
  RefreshCw,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  FileUp,
  HelpCircle,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { useExamIntegrity } from '../../../hooks/useExamIntegrity.js';
import { createExamTakingSession } from '../../../services/examTakingSession.js';
import { createExamStudentClient, isValidUuid } from '../../../services/examStudentClient.js';

export function ExamTakingModal({
  isOpen = false,
  assignmentId,
  onClose,
  studentClient = null,
  getAccessToken = null,
  onFinished = null,
}) {
  // Session & Lifecycle references
  const sessionRef = useRef(null);
  const stopIntegrityRef = useRef(null);
  const isMountedRef = useRef(true);
  const lifecycleEpochRef = useRef(0);

  // Callback refs to decouple from effect dependencies
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Track component mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // High level UI phases: 'idle' | 'initializing' | 'loading_questions' | 'taking' | 'submitted' | 'error'
  const [phase, setPhase] = useState('idle');
  const [globalError, setGlobalError] = useState(null);

  // Question & Navigation state (in-memory only)
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);

  // In-memory draft inputs for multiple_choice, fill_blank, short_answer, essay
  const [draftAnswers, setDraftAnswers] = useState({});

  // Saved answers snapshot from session
  const [savedAnswers, setSavedAnswers] = useState({});
  const [savingQuestionId, setSavingQuestionId] = useState(null);
  const [saveErrors, setSaveErrors] = useState({});

  // Text autosave serialization & debounce refs (in-memory only, zero persistent storage)
  const textDebounceTimerRef = useRef(null);
  const latestTextDraftsRef = useRef({});
  const isTextSavingRef = useRef(false);
  const inFlightSavePromiseRef = useRef(null);
  const queuedQuestionsToSaveRef = useRef(new Set());

  // Finalization state
  const [isFinalized, setIsFinalized] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Advisory Countdown state (Advisory ONLY - Zero client-side hard lock)
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [isAdvisoryExpired, setIsAdvisoryExpired] = useState(false);

  // Integrity hook integration
  // Starts strictly AFTER start success AND loadQuestions success
  const attemptId = sessionRef.current?.getAttemptId() || null;
  const isIntegrityEnabled = Boolean(
    isOpen &&
    questionsLoaded &&
    attemptId &&
    !isFinalized
  );

  const {
    isIntegrityActive,
    lastIntegrityResult,
    lastIntegrityError,
    stopIntegrity,
  } = useExamIntegrity({
    attemptId,
    enabled: isIntegrityEnabled,
    getAccessToken,
  });

  // Keep ref for manual stop
  useEffect(() => {
    stopIntegrityRef.current = stopIntegrity;
  }, [stopIntegrity]);

  // Cleanup helper
  const handleTeardown = useCallback(() => {
    if (stopIntegrityRef.current) {
      stopIntegrityRef.current();
    }
  }, []);

  // 1. Initial Start & Question Load Flow
  useEffect(() => {
    if (!isOpen || !isValidUuid(assignmentId)) {
      lifecycleEpochRef.current++;
      if (textDebounceTimerRef.current) {
        clearTimeout(textDebounceTimerRef.current);
        textDebounceTimerRef.current = null;
      }
      latestTextDraftsRef.current = {};
      queuedQuestionsToSaveRef.current.clear();
      setPhase('idle');
      setQuestions([]);
      setQuestionsLoaded(false);
      setIsFinalized(false);
      setSubmitResult(null);
      setGlobalError(null);
      setDraftAnswers({});
      setSavedAnswers({});
      setCurrentQuestionIndex(0);
      setShowSubmitConfirm(false);
      setIsSubmitting(false);
      setSubmitError(null);
      return;
    }

    let isSubscribed = true;
    let session = null;
    const epoch = ++lifecycleEpochRef.current;

    async function initSession() {
      try {
        setPhase('initializing');
        setGlobalError(null);

        const client = studentClient || createExamStudentClient();
        session = createExamTakingSession({
          assignmentId,
          studentClient: client,
          onConfirmedFinalized: (finalizedData) => {
            if (!isSubscribed || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;
            setIsFinalized(true);
            setSubmitResult(finalizedData);
            setPhase('submitted');
            setShowSubmitConfirm(false);
            setIsSubmitting(false);
            handleTeardown();
            if (onFinishedRef.current) onFinishedRef.current(finalizedData);
          },
          onStateChange: (state) => {
            if (!isSubscribed || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;
            setSavedAnswers(session.getAnswersState());
            setIsFinalized(session.isFinalized());
          },
        });

        sessionRef.current = session;

        // Step A: Start attempt
        const startRes = await session.start();
        if (!isSubscribed || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;

        if (!startRes.ok) {
          setPhase('error');
          setGlobalError({
            safeErrorCode: startRes.safeErrorCode || 'INTERNAL_ERROR',
            type: startRes.type,
          });
          return;
        }

        // If attempt was already finalized on server (e.g. resumed finalized)
        if (session.isFinalized()) {
          setIsFinalized(true);
          setSubmitResult(session.getStartResult());
          setPhase('submitted');
          handleTeardown();
          return;
        }

        // Step B: Load questions
        setPhase('loading_questions');
        const qRes = await session.loadQuestions();
        if (!isSubscribed || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;

        if (!qRes.ok) {
          setPhase('error');
          setGlobalError({
            safeErrorCode: qRes.safeErrorCode || 'INTERNAL_ERROR',
            type: qRes.type,
          });
          return;
        }

        const loadedQuestions = qRes.data.questions || [];
        setQuestions(loadedQuestions);
        setQuestionsLoaded(true);
        setSavedAnswers(session.getAnswersState());

        // Populate initial drafts from saved answers if any
        const initialDrafts = {};
        for (const q of loadedQuestions) {
          const saved = session.getAnswer(q.id);
          if (saved && saved.studentAnswerJson !== null && saved.studentAnswerJson !== undefined) {
            initialDrafts[q.id] = saved.studentAnswerJson;
            latestTextDraftsRef.current[q.id] = saved.studentAnswerJson;
          }
        }
        setDraftAnswers(initialDrafts);

        setPhase('taking');
      } catch (err) {
        if (!isSubscribed || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;
        setPhase('error');
        setGlobalError({
          safeErrorCode: 'INTERNAL_ERROR',
          message: err?.message,
        });
      }
    }

    initSession();

    return () => {
      isSubscribed = false;
      lifecycleEpochRef.current++;
      if (textDebounceTimerRef.current) {
        clearTimeout(textDebounceTimerRef.current);
        textDebounceTimerRef.current = null;
      }
      queuedQuestionsToSaveRef.current.clear();
      handleTeardown();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, [isOpen, assignmentId, studentClient, handleTeardown]);

  // 2. Advisory Countdown Timer (Advisory Only — No Hard Lock)
  useEffect(() => {
    if (phase !== 'taking' || !sessionRef.current) {
      setRemainingSeconds(null);
      setIsAdvisoryExpired(false);
      return;
    }

    const startData = sessionRef.current.getStartResult();
    const expiresAtStr = startData?.expires_at;
    if (!expiresAtStr) {
      setRemainingSeconds(null);
      return;
    }

    const expiresTime = new Date(expiresAtStr).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiresTime - now) / 1000));
      setRemainingSeconds(diff);
      if (diff <= 0) {
        setIsAdvisoryExpired(true);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [phase]);

  // Format advisory countdown
  const formattedCountdown = useMemo(() => {
    if (remainingSeconds === null) return null;
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [remainingSeconds]);

  // Navigation handlers (Strictly SAVE_ON_NEXT = NO, SAVE_ON_PREVIOUS = NO)
  const handlePrevious = useCallback(() => {
    setCurrentQuestionIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1));
  }, [questions.length]);

  const handleJumpToQuestion = useCallback((index) => {
    if (index >= 0 && index < questions.length) {
      setCurrentQuestionIndex(index);
    }
  }, [questions.length]);

  // Answer saving operations
  // single_choice: immediate save upon radio click
  const handleSaveSingleChoice = useCallback(
    async (question, optionKey) => {
      const session = sessionRef.current;
      const epoch = lifecycleEpochRef.current;
      if (!session || isFinalized || savingQuestionId) return;

      const qId = question.id;
      setSavingQuestionId(qId);
      setSaveErrors((prev) => ({ ...prev, [qId]: null }));
      setDraftAnswers((prev) => ({ ...prev, [qId]: optionKey }));

      const res = await session.saveAnswer({
        examQuestionId: qId,
        studentAnswerJson: optionKey,
      });

      if (!isMountedRef.current || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;

      if (!res.ok) {
        setSaveErrors((prev) => ({
          ...prev,
          [qId]: res.safeErrorCode || 'INTERNAL_ERROR',
        }));
      } else {
        setSavedAnswers(session.getAnswersState());
      }

      setSavingQuestionId(null);
    },
    [isFinalized, savingQuestionId]
  );

  // multiple_choice: explicit button click with deterministic key ordering
  const handleToggleMultipleChoiceOption = useCallback((qId, optKey) => {
    setDraftAnswers((prev) => {
      const currentList = Array.isArray(prev[qId]) ? [...prev[qId]] : [];
      const idx = currentList.indexOf(optKey);
      if (idx > -1) {
        currentList.splice(idx, 1);
      } else {
        currentList.push(optKey);
      }
      return { ...prev, [qId]: currentList };
    });
  }, []);

  const handleSaveMultipleChoice = useCallback(
    async (question) => {
      const session = sessionRef.current;
      const epoch = lifecycleEpochRef.current;
      if (!session || isFinalized || savingQuestionId) return;

      const qId = question.id;
      setSavingQuestionId(qId);
      setSaveErrors((prev) => ({ ...prev, [qId]: null }));

      const draftList = Array.isArray(draftAnswers[qId]) ? draftAnswers[qId] : [];
      // Deterministic ordering matching server options_json order
      const serverOptionKeys = (question.options || []).map((o) => o.key);
      const orderedKeys = serverOptionKeys.filter((k) => draftList.includes(k));

      const res = await session.saveAnswer({
        examQuestionId: qId,
        studentAnswerJson: orderedKeys,
      });

      if (!isMountedRef.current || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;

      if (!res.ok) {
        setSaveErrors((prev) => ({
          ...prev,
          [qId]: res.safeErrorCode || 'INTERNAL_ERROR',
        }));
      } else {
        setSavedAnswers(session.getAnswersState());
      }

      setSavingQuestionId(null);
    },
    [draftAnswers, isFinalized, savingQuestionId]
  );

  // text-based: fill_blank, short_answer, essay - serialized autosave queue
  const flushPendingTextSave = useCallback(
    async (targetQId = null) => {
      if (targetQId) {
        queuedQuestionsToSaveRef.current.add(targetQId);
      }

      if (isTextSavingRef.current) {
        if (inFlightSavePromiseRef.current) {
          try {
            await inFlightSavePromiseRef.current;
          } catch (_) {}
        }
        return;
      }

      isTextSavingRef.current = true;
      let resolveInFlight;
      inFlightSavePromiseRef.current = new Promise((resolve) => {
        resolveInFlight = resolve;
      });

      try {
        while (queuedQuestionsToSaveRef.current.size > 0) {
          const session = sessionRef.current;
          const epoch = lifecycleEpochRef.current;
          if (!session || isFinalized || !isMountedRef.current) break;

          const qId = queuedQuestionsToSaveRef.current.values().next().value;
          queuedQuestionsToSaveRef.current.delete(qId);

          const textValue =
            typeof latestTextDraftsRef.current[qId] === 'string'
              ? latestTextDraftsRef.current[qId]
              : typeof draftAnswers[qId] === 'string'
              ? draftAnswers[qId]
              : '';

          const currentSaved = session.getAnswersState()[qId]?.studentAnswerJson;
          if (currentSaved === textValue) {
            continue;
          }

          setSavingQuestionId(qId);
          setSaveErrors((prev) => ({ ...prev, [qId]: null }));

          const res = await session.saveAnswer({
            examQuestionId: qId,
            studentAnswerJson: textValue,
          });

          if (!isMountedRef.current || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) {
            break;
          }

          if (!res.ok) {
            setSaveErrors((prev) => ({
              ...prev,
              [qId]: res.safeErrorCode || 'INTERNAL_ERROR',
            }));
          } else {
            setSavedAnswers(session.getAnswersState());
          }

          setSavingQuestionId(null);

          const newestText =
            typeof latestTextDraftsRef.current[qId] === 'string'
              ? latestTextDraftsRef.current[qId]
              : '';
          if (newestText !== textValue) {
            queuedQuestionsToSaveRef.current.add(qId);
          }
        }
      } finally {
        isTextSavingRef.current = false;
        setSavingQuestionId(null);
        if (resolveInFlight) {
          resolveInFlight();
        }
        inFlightSavePromiseRef.current = null;
      }
    },
    [draftAnswers, isFinalized]
  );

  const handleTextDraftChange = useCallback(
    (qId, text) => {
      setDraftAnswers((prev) => ({ ...prev, [qId]: text }));
      latestTextDraftsRef.current[qId] = text;

      if (textDebounceTimerRef.current) {
        clearTimeout(textDebounceTimerRef.current);
      }

      textDebounceTimerRef.current = setTimeout(() => {
        textDebounceTimerRef.current = null;
        flushPendingTextSave(qId);
      }, 800);
    },
    [flushPendingTextSave]
  );

  const handleTextBlur = useCallback(
    (qId) => {
      if (textDebounceTimerRef.current) {
        clearTimeout(textDebounceTimerRef.current);
        textDebounceTimerRef.current = null;
      }
      flushPendingTextSave(qId);
    },
    [flushPendingTextSave]
  );

  const handleSaveTextAnswer = useCallback(
    async (question) => {
      const session = sessionRef.current;
      const epoch = lifecycleEpochRef.current;
      if (!session || isFinalized) return;

      if (textDebounceTimerRef.current) {
        clearTimeout(textDebounceTimerRef.current);
        textDebounceTimerRef.current = null;
      }
      const qId = question?.id;
      if (qId) {
        await flushPendingTextSave(qId);
      }
      if (!isMountedRef.current || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;
    },
    [flushPendingTextSave, isFinalized]
  );

  // Submit Operations
  const handleOpenSubmitDialog = useCallback(() => {
    setSubmitError(null);
    setShowSubmitConfirm(true);
  }, []);

  const handleCancelSubmitDialog = useCallback(() => {
    setShowSubmitConfirm(false);
    setSubmitError(null);
  }, []);

  const handleConfirmSubmit = useCallback(async () => {
    const session = sessionRef.current;
    const epoch = lifecycleEpochRef.current;
    if (!session || isFinalized || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    // Cancel pending debounce timer before pre-submit flush
    if (textDebounceTimerRef.current) {
      clearTimeout(textDebounceTimerRef.current);
      textDebounceTimerRef.current = null;
    }

    // Pre-submit flush: Enqueue all dirty text answers across the exam
    for (const [qId, text] of Object.entries(latestTextDraftsRef.current)) {
      const savedVal = session.getAnswersState()[qId]?.studentAnswerJson;
      if (savedVal !== text) {
        queuedQuestionsToSaveRef.current.add(qId);
      }
    }

    // Await serialized text flush until queue is completely empty
    await flushPendingTextSave();

    if (!isMountedRef.current || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;

    // Note: Do NOT stop integrity at submit start!
    const res = await session.submitAttempt();

    if (!isMountedRef.current || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) return;

    if (!res.ok) {
      setIsSubmitting(false);
      setSubmitError(res.safeErrorCode || 'INTERNAL_ERROR');
      // Session and integrity remain active on submit failure
      return;
    }

    // Success -> onConfirmedFinalized handles finalization & teardown
    setIsSubmitting(false);
    setShowSubmitConfirm(false);
  }, [flushPendingTextSave, isFinalized, isSubmitting]);

  // Close modal handler
  const handleModalClose = useCallback(() => {
    // Closing before submit: does NOT auto-submit, does NOT finalize
    lifecycleEpochRef.current++;
    handleTeardown();
    if (onCloseRef.current) onCloseRef.current();
  }, [handleTeardown]);

  if (!isOpen) return null;

  const currentQuestion = questions[currentQuestionIndex] || null;
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(savedAnswers).length;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Làm bài thi trực tuyến</h2>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {isIntegrityActive && (
                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" /> Giám sát bài thi đang bật
                  </span>
                )}
                {attemptId && (
                  <span className="font-mono text-[11px] text-slate-400">
                    ID: {attemptId.slice(0, 8)}...
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Advisory Countdown Display */}
            {formattedCountdown && phase === 'taking' && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-sm font-semibold border ${
                  isAdvisoryExpired
                    ? 'bg-rose-50 text-rose-600 border-rose-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>{formattedCountdown}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleModalClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Đóng cửa sổ"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Phase: Initializing / Loading */}
          {(phase === 'initializing' || phase === 'loading_questions') && (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
              <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
              <div className="space-y-1">
                <p className="text-base font-semibold text-slate-800">
                  {phase === 'initializing' ? 'Đang khởi tạo lượt làm bài...' : 'Đang tải đề thi an toàn...'}
                </p>
                <p className="text-sm text-slate-500">Vui lòng không tắt trình duyệt trong quá trình nạp đề.</p>
              </div>
            </div>
          )}

          {/* Phase: Global Error */}
          {phase === 'error' && (
            <div className="py-16 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-slate-800">Không thể tải bài thi</h3>
                <p className="text-sm text-slate-600">
                  Đã xảy ra sự cố khi nạp đề thi. Mã lỗi an toàn:{' '}
                  <code className="px-2 py-0.5 bg-slate-100 rounded font-mono text-xs font-semibold text-rose-600">
                    {globalError?.safeErrorCode || 'INTERNAL_ERROR'}
                  </code>
                </p>
              </div>
              <button
                type="button"
                onClick={handleModalClose}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Đóng bài thi
              </button>
            </div>
          )}

          {/* Phase: Submitted / Finalized View */}
          {phase === 'submitted' && (
            <div className="py-16 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5">
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-800">Nộp bài thi thành công</h3>
                <p className="text-sm text-slate-600">
                  Bài thi của bạn đã được ghi nhận an toàn trên hệ thống.
                </p>
                {submitResult?.status === 'graded' && typeof submitResult?.total_score === 'number' && (
                  <div className="p-4 bg-blue-50/70 border border-blue-100 rounded-xl mt-3 space-y-1">
                    <p className="text-xs text-blue-600 font-medium">Điểm số đạt được</p>
                    <p className="text-2xl font-black text-blue-700">
                      {submitResult.total_score} / {submitResult.max_score}
                    </p>
                  </div>
                )}
                {submitResult?.status === 'pending_manual_grade' && (
                  <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-xl mt-3">
                    <p className="text-xs text-amber-700 font-medium">
                      Bài thi có câu hỏi tự luận, đang chờ giáo viên chấm điểm.
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleModalClose}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Hoàn tất
              </button>
            </div>
          )}

          {/* Phase: Taking Exam Active View */}
          {phase === 'taking' && currentQuestion && (
            <div className="space-y-6">
              {/* Advisory Expired Notice Banner */}
              {isAdvisoryExpired && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span>
                    Thời gian theo đồng hồ hiển thị đã hết. Hãy khẩn trương hoàn thành và nộp bài.
                  </span>
                </div>
              )}

              {/* Question Navigation Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-100">
                {questions.map((q, idx) => {
                  const isSaved = Boolean(savedAnswers[q.id]);
                  const isCurrent = idx === currentQuestionIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => handleJumpToQuestion(idx)}
                      className={`flex-shrink-0 w-8 h-8 rounded-lg text-xs font-semibold flex items-center justify-center transition-all ${
                        isCurrent
                          ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-300'
                          : isSaved
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              {/* Question Card Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-md text-xs font-bold">
                    Câu {currentQuestionIndex + 1} / {totalQuestions}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    ({currentQuestion.points} điểm)
                  </span>
                </div>

                {savedAnswers[currentQuestion.id] && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md">
                    <Check className="w-3.5 h-3.5" /> Đã lưu
                  </span>
                )}
              </div>

              {/* Question Prompt */}
              <div className="text-base text-slate-800 font-medium leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 whitespace-pre-wrap">
                {currentQuestion.prompt}
              </div>

              {/* Question Answer Controls by Type */}
              <div className="space-y-4 pt-2">
                {/* 1. Single Choice: Radio Select immediately saves */}
                {currentQuestion.question_type === 'single_choice' && (
                  <div className="space-y-2.5">
                    {(currentQuestion.options || []).map((opt) => {
                      const isSelected =
                        draftAnswers[currentQuestion.id] === opt.key ||
                        savedAnswers[currentQuestion.id]?.studentAnswerJson === opt.key;
                      const isSaving = savingQuestionId === currentQuestion.id;

                      return (
                        <label
                          key={opt.key}
                          className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-blue-50/60 border-blue-300 shadow-sm'
                              : 'bg-white border-slate-200 hover:bg-slate-50/80'
                          } ${isSaving ? 'opacity-70 pointer-events-none' : ''}`}
                        >
                          <input
                            type="radio"
                            name={`single_choice_${currentQuestion.id}`}
                            value={opt.key}
                            checked={isSelected}
                            disabled={isSaving || isFinalized}
                            onChange={() => handleSaveSingleChoice(currentQuestion, opt.key)}
                            className="mt-0.5 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1 text-sm text-slate-800">
                            <span className="font-bold mr-1.5 text-slate-600">{opt.key}.</span>
                            <span>{opt.text}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* 2. Multiple Choice: Local draft checkboxes + Explicit Save Button */}
                {currentQuestion.question_type === 'multiple_choice' && (
                  <div className="space-y-3">
                    <div className="space-y-2.5">
                      {(currentQuestion.options || []).map((opt) => {
                        const currentList = Array.isArray(draftAnswers[currentQuestion.id])
                          ? draftAnswers[currentQuestion.id]
                          : Array.isArray(savedAnswers[currentQuestion.id]?.studentAnswerJson)
                          ? savedAnswers[currentQuestion.id].studentAnswerJson
                          : [];
                        const isChecked = currentList.includes(opt.key);
                        const isSaving = savingQuestionId === currentQuestion.id;

                        return (
                          <label
                            key={opt.key}
                            className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                              isChecked
                                ? 'bg-blue-50/60 border-blue-300 shadow-sm'
                                : 'bg-white border-slate-200 hover:bg-slate-50/80'
                            } ${isSaving ? 'opacity-70' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isSaving || isFinalized}
                              onChange={() => handleToggleMultipleChoiceOption(currentQuestion.id, opt.key)}
                              className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                            />
                            <div className="flex-1 text-sm text-slate-800">
                              <span className="font-bold mr-1.5 text-slate-600">{opt.key}.</span>
                              <span>{opt.text}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => handleSaveMultipleChoice(currentQuestion)}
                        disabled={savingQuestionId === currentQuestion.id || isFinalized}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50 transition-colors"
                      >
                        {savingQuestionId === currentQuestion.id ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang lưu...
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" /> Lưu câu trả lời
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. Fill in the Blank: Text Input + Explicit Save Button */}
                {currentQuestion.question_type === 'fill_blank' && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Nhập từ hoặc cụm từ cần điền..."
                      value={
                        typeof draftAnswers[currentQuestion.id] === 'string'
                          ? draftAnswers[currentQuestion.id]
                          : typeof savedAnswers[currentQuestion.id]?.studentAnswerJson === 'string'
                          ? savedAnswers[currentQuestion.id].studentAnswerJson
                          : ''
                      }
                      disabled={savingQuestionId === currentQuestion.id || isFinalized}
                      onChange={(e) => handleTextDraftChange(currentQuestion.id, e.target.value)}
                      onBlur={() => handleTextBlur(currentQuestion.id)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveTextAnswer(currentQuestion)}
                        disabled={savingQuestionId === currentQuestion.id || isFinalized}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50 transition-colors"
                      >
                        {savingQuestionId === currentQuestion.id ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang lưu...
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" /> Lưu câu trả lời
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 4. Short Answer: Text Input/Textarea + Explicit Save Button */}
                {currentQuestion.question_type === 'short_answer' && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Nhập câu trả lời ngắn..."
                      value={
                        typeof draftAnswers[currentQuestion.id] === 'string'
                          ? draftAnswers[currentQuestion.id]
                          : typeof savedAnswers[currentQuestion.id]?.studentAnswerJson === 'string'
                          ? savedAnswers[currentQuestion.id].studentAnswerJson
                          : ''
                      }
                      disabled={savingQuestionId === currentQuestion.id || isFinalized}
                      onChange={(e) => handleTextDraftChange(currentQuestion.id, e.target.value)}
                      onBlur={() => handleTextBlur(currentQuestion.id)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveTextAnswer(currentQuestion)}
                        disabled={savingQuestionId === currentQuestion.id || isFinalized}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50 transition-colors"
                      >
                        {savingQuestionId === currentQuestion.id ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang lưu...
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" /> Lưu câu trả lời
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 5. Essay: Textarea + Explicit Save Button */}
                {currentQuestion.question_type === 'essay' && (
                  <div className="space-y-3">
                    <textarea
                      rows={5}
                      placeholder="Nhập bài tự luận của bạn..."
                      value={
                        typeof draftAnswers[currentQuestion.id] === 'string'
                          ? draftAnswers[currentQuestion.id]
                          : typeof savedAnswers[currentQuestion.id]?.studentAnswerJson === 'string'
                          ? savedAnswers[currentQuestion.id].studentAnswerJson
                          : ''
                      }
                      disabled={savingQuestionId === currentQuestion.id || isFinalized}
                      onChange={(e) => handleTextDraftChange(currentQuestion.id, e.target.value)}
                      onBlur={() => handleTextBlur(currentQuestion.id)}
                      className="w-full p-4 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveTextAnswer(currentQuestion)}
                        disabled={savingQuestionId === currentQuestion.id || isFinalized}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50 transition-colors"
                      >
                        {savingQuestionId === currentQuestion.id ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang lưu...
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" /> Lưu câu trả lời
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 6. Image Upload: Strictly Disabled */}
                {currentQuestion.question_type === 'image_upload' && (
                  <div className="p-6 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-center space-y-2">
                    <div className="p-3 bg-slate-200/70 text-slate-500 rounded-xl">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Tải ảnh bài làm</p>
                    <p className="text-xs text-slate-500 max-w-sm">
                      Tính năng nộp hình ảnh đang tạm thời được tắt theo quy định bảo mật đề thi.
                    </p>
                    <button
                      type="button"
                      disabled
                      className="mt-2 px-4 py-2 bg-slate-200 text-slate-400 rounded-xl text-xs font-medium cursor-not-allowed"
                    >
                      Tải ảnh lên (Vô hiệu hóa)
                    </button>
                  </div>
                )}

                {/* 7. File Upload: Strictly Disabled */}
                {currentQuestion.question_type === 'file_upload' && (
                  <div className="p-6 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-center space-y-2">
                    <div className="p-3 bg-slate-200/70 text-slate-500 rounded-xl">
                      <FileUp className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Tải tệp đính kèm bài làm</p>
                    <p className="text-xs text-slate-500 max-w-sm">
                      Tính năng nộp tệp đính kèm đang tạm thời được tắt theo quy định bảo mật đề thi.
                    </p>
                    <button
                      type="button"
                      disabled
                      className="mt-2 px-4 py-2 bg-slate-200 text-slate-400 rounded-xl text-xs font-medium cursor-not-allowed"
                    >
                      Tải tệp lên (Vô hiệu hóa)
                    </button>
                  </div>
                )}

                {/* Save Error Notice */}
                {saveErrors[currentQuestion.id] && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>Lỗi khi lưu câu trả lời: Mã lỗi {saveErrors[currentQuestion.id]}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Modal Footer Controls */}
        {phase === 'taking' && (
          <footer className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevious}
                disabled={currentQuestionIndex === 0}
                className="inline-flex items-center gap-1 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Câu trước
              </button>

              <button
                type="button"
                onClick={handleNext}
                disabled={currentQuestionIndex === totalQuestions - 1}
                className="inline-flex items-center gap-1 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium disabled:opacity-40 transition-colors"
              >
                Câu sau <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 hidden sm:inline">
                Đã trả lời: <strong className="text-slate-800">{answeredCount}/{totalQuestions}</strong>
              </span>

              <button
                type="button"
                onClick={handleOpenSubmitDialog}
                disabled={isFinalized}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
              >
                <Send className="w-3.5 h-3.5" /> Nộp bài
              </button>
            </div>
          </footer>
        )}

        {/* Submit Confirmation Dialog */}
        {showSubmitConfirm && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                  <HelpCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-800">Xác nhận nộp bài</h4>
                  <p className="text-xs text-slate-500">Kiểm tra thông tin bài thi trước khi nộp</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs text-slate-700">
                <div className="flex justify-between">
                  <span>Tổng số câu hỏi:</span>
                  <strong className="font-semibold">{totalQuestions} câu</strong>
                </div>
                <div className="flex justify-between">
                  <span>Số câu đã lưu:</span>
                  <strong className="text-emerald-600 font-semibold">{answeredCount} câu</strong>
                </div>
                {unansweredCount > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Số câu chưa trả lời:</span>
                    <strong className="font-semibold">{unansweredCount} câu</strong>
                  </div>
                )}
              </div>

              {submitError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                  Lỗi khi nộp bài: Mã lỗi {submitError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelSubmitDialog}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                >
                  Làm tiếp
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSubmit}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang nộp...
                    </>
                  ) : (
                    'Đồng ý nộp bài'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExamTakingModal;
