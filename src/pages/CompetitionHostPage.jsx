import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Tv,
  Trophy,
  Users,
  Play,
  Pause,
  SkipForward,
  CheckCircle,
  XCircle,
  Plus,
  BookOpen,
  FileSpreadsheet,
  ChevronDown,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Crown,
  Medal,
  Copy,
  Sparkles,
  HelpCircle,
  Clock,
  ArrowRight,
  RotateCcw,
  BarChart3,
  Award,
  StopCircle,
  CheckCircle2,
  PieChart,
  Flame,
  Star
} from 'lucide-react';
import {
  hostCreateSession,
  hostStartSession,
  hostPauseSession,
  hostResumeSession,
  hostNextQuestion,
  hostFinishSession,
  hostCancelSession,
  hostCloseQuestion,
  getHostSessionMetadata,
  getHostQuestionResults,
  getHostQuestionResultByOrder,
  getLeaderboardSnapshot
} from '../services/competitionClient.js';
import { useHostCompetitionPolling, DEFAULT_SUBMISSION_STATS } from '../hooks/useHostCompetitionPolling.js';
import { HostQuestionAnalyticsView } from '../components/competition/HostQuestionAnalyticsView.jsx';
import { HostExportControls } from '../components/competition/HostExportControls.jsx';
import { HostPrintableReport } from '../components/competition/HostPrintableReport.jsx';
import { CompetitionQuestionBankModal } from '../components/competition/CompetitionQuestionBankModal.jsx';
import { CompetitionImportExcelModal } from '../components/competition/CompetitionImportExcelModal.jsx';
import {
  reindexCompetitionQuestions,
  sanitizeQuestionsForCreation,
  MAX_COMPETITION_QUESTIONS
} from '../utils/competitionQuestionAdapters.js';

// Default starter questions for quick session creation
const DEFAULT_QUESTIONS = [
  {
    question_order: 1,
    question_text: 'Thủ đô của Việt Nam là thành phố nào?',
    question_type: 'single_choice',
    points: 10.00,
    time_limit_seconds: 30,
    options: [
      { id: 'opt_1', text: 'Hà Nội' },
      { id: 'opt_2', text: 'TP. Hồ Chí Minh' },
      { id: 'opt_3', text: 'Đà Nẵng' },
      { id: 'opt_4', text: 'Cần Thơ' }
    ],
    correct_answer: { option_id: 'opt_1' }
  },
  {
    question_order: 2,
    question_text: 'Kết quả của phép tính 25 + 75 là bao nhiêu?',
    question_type: 'single_choice',
    points: 10.00,
    time_limit_seconds: 30,
    options: [
      { id: 'opt_1', text: '90' },
      { id: 'opt_2', text: '100' },
      { id: 'opt_3', text: '110' },
      { id: 'opt_4', text: '120' }
    ],
    correct_answer: { option_id: 'opt_2' }
  },
  {
    question_order: 3,
    question_text: 'Một năm thông thường có bao nhiêu ngày?',
    question_type: 'single_choice',
    points: 10.00,
    time_limit_seconds: 30,
    options: [
      { id: 'opt_1', text: '360 ngày' },
      { id: 'opt_2', text: '365 ngày' },
      { id: 'opt_3', text: '366 ngày' },
      { id: 'opt_4', text: '370 ngày' }
    ],
    correct_answer: { option_id: 'opt_2' }
  }
];

// Storage Key for Host Session Persistence (Scoped strictly to Host Competition)
export const HOST_SESSION_STORAGE_KEY = 'competition_host_active_session_id';

// Strict UUID format validator (RFC 4122)
export const isValidSessionUUID = (id) => {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
};

// Error classification helper: Distinguishes authoritative failures (403/404/not-found) from transient errors (5xx/network)
export const isAuthoritativeSessionFailure = (errorOrDetails) => {
  if (!errorOrDetails) return false;
  if (typeof errorOrDetails === 'string') {
    const lower = errorOrDetails.toLowerCase();
    return (
      lower.includes('không tồn tại') ||
      lower.includes('not found') ||
      lower.includes('không có quyền') ||
      lower.includes('permission denied') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden') ||
      lower.includes('invalid session')
    );
  }
  const code = errorOrDetails.error_code || errorOrDetails.code;
  const status = errorOrDetails.status;
  const msg = (errorOrDetails.message || '').toLowerCase();

  // Explicit authoritative error codes
  if (
    code === 'NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN_OR_NOT_FOUND' ||
    code === 'INVALID_SESSION' ||
    code === 'INVALID_SESSION_ID' ||
    code === '42501' ||
    code === 'PGRST116'
  ) {
    return true;
  }

  // Explicit HTTP status codes for auth / not found
  if (status === 401 || status === 403 || status === 404) {
    return true;
  }

  // Text message check for authoritative rejection
  if (
    msg.includes('không tồn tại') ||
    msg.includes('not found') ||
    msg.includes('không có quyền') ||
    msg.includes('permission denied') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  ) {
    return true;
  }

  return false;
};

// Safe initial session resolver (Query param -> sessionStorage -> null)
export const getInitialActiveSessionId = () => {
  try {
    if (typeof window === 'undefined') return null;
    const urlParams = new URLSearchParams(window.location.search);
    const urlSession = urlParams.get('sessionId') || urlParams.get('session_id');
    if (urlSession && isValidSessionUUID(urlSession)) {
      return urlSession.trim();
    }
    const stored = window.sessionStorage?.getItem(HOST_SESSION_STORAGE_KEY);
    if (stored && isValidSessionUUID(stored)) {
      return stored.trim();
    }
    if (stored) {
      // Discard invalid / non-UUID entries
      window.sessionStorage?.removeItem(HOST_SESSION_STORAGE_KEY);
    }
  } catch (_e) {
    // Fail safe
  }
  return null;
};

export function CompetitionHostPage() {
  // Navigation & Session State
  const initialResolvedId = getInitialActiveSessionId();
  const [activeSessionId, setActiveSessionId] = useState(initialResolvedId);
  const activeSessionIdRef = useRef(activeSessionId);
  const restoredSessionPendingValidationRef = useRef(Boolean(initialResolvedId));

  const [createdQuestionCount, setCreatedQuestionCount] = useState(3);
  const [notification, setNotification] = useState(null);
  const [actionPending, setActionPending] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'cancel' | 'finish', title, message, onConfirm }
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Auto show notification banner
  const showToast = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  }, []);

  // Fail-closed helper for invalid / unauthorized restored sessions
  const clearRestoredSessionAndReturnToSetup = useCallback((failureReason) => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem(HOST_SESSION_STORAGE_KEY);
        if (window.location.search) {
          window.history?.replaceState({}, '', window.location.pathname);
        }
      }
    } catch (_e) {}

    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    restoredSessionPendingValidationRef.current = false;
    setQuestions(DEFAULT_QUESTIONS);
    setReviewEnabled(false);
    setLeaderboardData([]);
    setLeaderboardError(null);
    setIsLeaderboardOpen(false);
    setQuestionResults(null);
    setReviewedQuestionOrder(null);
    setReviewedQuestionResults(null);
    setAuthoritativeTotalQuestions(null);
    setExportAnalyticsData(null);
    setIsAnonymizedExport(false);
    setExportTopN('all');
    setPrintOrientation('portrait');
    setHostViewMode('LIVE_QUESTION');
    setFinishedTab('PODIUM');
    autoResultAttemptRef.current = null;
    setTimeLeftSeconds(null);

    if (failureReason) {
      showToast(failureReason, 'error');
    }
  }, [showToast]);

  // Synchronize activeSessionIdRef immediately and update sessionStorage persistence
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    try {
      if (typeof window !== 'undefined') {
        if (activeSessionId && isValidSessionUUID(activeSessionId)) {
          window.sessionStorage?.setItem(HOST_SESSION_STORAGE_KEY, activeSessionId);
        } else {
          window.sessionStorage?.removeItem(HOST_SESSION_STORAGE_KEY);
        }
      }
    } catch (_e) {
      // Fail safe
    }
  }, [activeSessionId]);

  // Host View Mode State (R3: LIVE_QUESTION, QUESTION_RESULTS, LEADERBOARD, FINAL_RESULTS)
  const [hostViewMode, setHostViewMode] = useState('LIVE_QUESTION');
  const [finishedTab, setFinishedTab] = useState('PODIUM'); // 'PODIUM' | 'ANALYTICS'
  const [exportAnalyticsData, setExportAnalyticsData] = useState(null);
  const [isAnonymizedExport, setIsAnonymizedExport] = useState(false);
  const [exportTopN, setExportTopN] = useState('all');
  const [printOrientation, setPrintOrientation] = useState('portrait');
  const [questionResults, setQuestionResults] = useState(null);
  const [reviewedQuestionOrder, setReviewedQuestionOrder] = useState(null);
  const [reviewedQuestionResults, setReviewedQuestionResults] = useState(null);
  const [isHistoricalResultsLoading, setIsHistoricalResultsLoading] = useState(false);
  const [authoritativeTotalQuestions, setAuthoritativeTotalQuestions] = useState(null);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(null);
  const [leaderboardError, setLeaderboardError] = useState(null);
  const latestLeaderboardRequestIdRef = useRef(0);

  // Setup Form State
  const [title, setTitle] = useState('Đấu Trường Tri Thức V1');
  const [description, setDescription] = useState('Phòng thi đấu vui học dành cho các bạn học sinh.');
  const [maxParticipants, setMaxParticipants] = useState(30);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [isQuestionBankModalOpen, setIsQuestionBankModalOpen] = useState(false);
  const [isImportExcelModalOpen, setIsImportExcelModalOpen] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // Polling Hook for Active Session
  const {
    snapshot,
    participants,
    submissionStats,
    isLoading: isPollingLoading,
    error: pollingError,
    errorDetails: pollingErrorDetails,
    refreshNow,
    setSnapshot
  } = useHostCompetitionPolling(activeSessionId);

  // Restored Session Validation Guard (Fail-closed on Authoritative Failure, Retain on Transient Error)
  useEffect(() => {
    if (!restoredSessionPendingValidationRef.current || !activeSessionId) {
      return;
    }

    // Case 1: Initial authoritative snapshot successfully loaded and verified
    if (snapshot && snapshot.id === activeSessionId) {
      restoredSessionPendingValidationRef.current = false;
      return;
    }

    // Case 2: Authoritative failure returned during initial restoration
    if (pollingErrorDetails || pollingError) {
      const errInfo = pollingErrorDetails || { message: pollingError };
      if (isAuthoritativeSessionFailure(errInfo)) {
        clearRestoredSessionAndReturnToSetup(
          errInfo.message || 'Phòng thi không tồn tại hoặc bạn không có quyền quản trị.'
        );
      }
      // If transient (offline, timeout, 5xx), do NOT clear session; keep session for Host retry/reconnect
    }
  }, [snapshot, activeSessionId, pollingErrorDetails, pollingError, clearRestoredSessionAndReturnToSetup]);

  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  // Safe question results fetcher (fail-closed, no busy loop)
  const isFetchingResultsRef = useRef(false);
  const autoResultAttemptRef = useRef(null);

  // Track current question ID changes to reset to LIVE_QUESTION, clear questionResults, and reset auto attempt guard
  const currentQuestionId = snapshot?.current_question_id;
  const prevQuestionIdRef = useRef(currentQuestionId);

  useEffect(() => {
    if (prevQuestionIdRef.current !== currentQuestionId) {
      prevQuestionIdRef.current = currentQuestionId;
      if (snapshotRef.current?.status !== 'finished') {
        setQuestionResults(null);
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        setHostViewMode('LIVE_QUESTION');
        autoResultAttemptRef.current = null;
      }
    }
  }, [currentQuestionId]);

  // Single-fetch session metadata (authoritative total_questions) on session establishment/restoration
  useEffect(() => {
    let isSubscribed = true;
    if (!activeSessionId || !isValidSessionUUID(activeSessionId)) {
      setAuthoritativeTotalQuestions(null);
      return;
    }

    // Reset when switching to a different session until fresh authoritative metadata arrives
    setAuthoritativeTotalQuestions(null);

    getHostSessionMetadata(activeSessionId)
      .then((res) => {
        if (isSubscribed && res?.success && res?.data?.total_questions) {
          setAuthoritativeTotalQuestions(res.data.total_questions);
        }
      })
      .catch(() => {
        // Fail-closed without busy looping
      });

    return () => {
      isSubscribed = false;
    };
  }, [activeSessionId]);

  // Determine current active state
  const currentStatus = snapshot?.status || (activeSessionId ? 'waiting' : 'setup');

  const hasAuthoritativeTotal =
    Number.isInteger(Number(authoritativeTotalQuestions)) &&
    Number(authoritativeTotalQuestions) > 0;

  const isFinalQuestion =
    hasAuthoritativeTotal &&
    Number(snapshot?.current_question_index) >= Number(authoritativeTotalQuestions);

  const effectiveTotalQuestions = hasAuthoritativeTotal
    ? Number(authoritativeTotalQuestions)
    : (createdQuestionCount && createdQuestionCount > 0 ? createdQuestionCount : (questions?.length || 1));

  const isReviewingHistory = Boolean(
    reviewedQuestionOrder !== null &&
    (snapshot?.status === 'finished' || (snapshot?.current_question_index && reviewedQuestionOrder < snapshot.current_question_index))
  );
  const activeDisplayedResults = isReviewingHistory ? reviewedQuestionResults : questionResults;
  const activeDisplayedOrder = reviewedQuestionOrder ?? snapshot?.current_question_index ?? 1;

  // UI Visibility Contract & Consistency Guard for Live Submission Stats (S2)
  const isSubmissionStatsAuthoritative = Boolean(
    hostViewMode === 'LIVE_QUESTION' &&
    (currentStatus === 'in_progress' || currentStatus === 'paused') &&
    snapshot?.current_question_id &&
    submissionStats?.has_active_question === true &&
    submissionStats?.current_question_id === snapshot.current_question_id
  );

  const activeStats = isSubmissionStatsAuthoritative ? submissionStats : DEFAULT_SUBMISSION_STATS;

  // Derive sanitized current-question submission stats
  const totalEligible = activeStats.total_eligible ?? participants.filter(p => p.status !== 'kicked').length;
  const submittedCount = activeStats.submitted_count ?? 0;
  const notSubmittedCount = activeStats.not_submitted_count ?? Math.max(0, totalEligible - submittedCount);
  const progressPercentage = totalEligible > 0 ? Math.round((submittedCount / totalEligible) * 100) : 0;
  const submittedList = activeStats.participants?.filter(p => p.submitted) || [];
  const notSubmittedList = activeStats.participants?.filter(p => !p.submitted) || [];

  // Question Results Consistency Guard (R2 Section 18 + R12 Historical Review)
  const isQuestionResultsAuthoritative = Boolean(
    hostViewMode === 'QUESTION_RESULTS' &&
    ((isReviewingHistory && reviewedQuestionResults?.success && reviewedQuestionResults?.question_closed === true) ||
     (!isReviewingHistory && questionResults?.success && questionResults?.question_closed === true &&
      snapshot?.current_question_id && questionResults?.question_id === snapshot.current_question_id))
  );

  // Load Leaderboard data on demand with session matching and stale response safety (Blocker 1 & Race Guard)
  const fetchLeaderboard = useCallback(async (targetSessionIdParam) => {
    const targetSessionId = (typeof targetSessionIdParam === 'string' && targetSessionIdParam)
      ? targetSessionIdParam
      : activeSessionIdRef.current;

    if (!targetSessionId || typeof targetSessionId !== 'string') {
      return { success: false, error_code: 'NO_SESSION' };
    }

    // Pre-flight check against activeSessionIdRef
    if (activeSessionIdRef.current && targetSessionId !== activeSessionIdRef.current) {
      return { success: false, error_code: 'STALE_SESSION' };
    }

    const requestId = ++latestLeaderboardRequestIdRef.current;
    setIsLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const res = await getLeaderboardSnapshot({ sessionId: targetSessionId });

      // Guard 1: Request ID race check
      if (requestId !== latestLeaderboardRequestIdRef.current) {
        return { success: false, error_code: 'STALE_REQUEST' };
      }

      // Guard 2: Session Identity Guard (Blocker 1 - Must verify targetSessionId matches current activeSessionId)
      if (!activeSessionIdRef.current || targetSessionId !== activeSessionIdRef.current) {
        return { success: false, error_code: 'STALE_SESSION' };
      }

      if (res.success && Array.isArray(res.data?.leaderboard)) {
        setLeaderboardData(res.data.leaderboard);
        setLeaderboardError(null);
        return { success: true, data: res.data.leaderboard };
      } else {
        const errMsg = res.message || 'Chưa thể tải dữ liệu bảng xếp hạng.';
        setLeaderboardError(errMsg);
        showToast(errMsg, 'error');
        return { success: false, error_code: res.error_code || 'RPC_ERROR', message: errMsg };
      }
    } catch (_err) {
      if (
        requestId === latestLeaderboardRequestIdRef.current &&
        activeSessionIdRef.current &&
        targetSessionId === activeSessionIdRef.current
      ) {
        const netErrMsg = 'Lỗi mạng khi tải bảng xếp hạng.';
        setLeaderboardError(netErrMsg);
        showToast(netErrMsg, 'error');
      }
      return { success: false, error_code: 'NETWORK_ERROR', message: 'Lỗi mạng khi tải bảng xếp hạng.' };
    } finally {
      if (
        requestId === latestLeaderboardRequestIdRef.current &&
        (!activeSessionIdRef.current || targetSessionId === activeSessionIdRef.current)
      ) {
        setIsLeaderboardLoading(false);
      }
    }
  }, []);

  // Trigger Leaderboard fetch when opening panel
  useEffect(() => {
    if (isLeaderboardOpen && activeSessionId) {
      fetchLeaderboard(activeSessionId);
    }
  }, [isLeaderboardOpen, activeSessionId, fetchLeaderboard]);

  // Finished session sync guard (Refresh, Reconnect, or Remote Finish)
  useEffect(() => {
    if (snapshot?.status === 'finished') {
      setHostViewMode('FINAL_RESULTS');
      setQuestionResults(null);
      setReviewedQuestionOrder(null);
      setReviewedQuestionResults(null);
      setTimeLeftSeconds(null);
      autoResultAttemptRef.current = null;
      if (activeSessionId) {
        fetchLeaderboard(activeSessionId);
      }
    }
  }, [snapshot?.status, activeSessionId, fetchLeaderboard]);

  // Safe question results fetcher (fail-closed, no busy loop)
  const fetchResultsSafely = useCallback(async (sessionIdParam) => {
    const sessionId = (typeof sessionIdParam === 'string' && sessionIdParam)
      ? sessionIdParam
      : activeSessionIdRef.current;
    if (!sessionId || isFetchingResultsRef.current) return { success: false, error_code: 'BUSY_OR_INVALID' };
    isFetchingResultsRef.current = true;
    setIsResultsLoading(true);
    try {
      const res = await getHostQuestionResults(sessionId);
      if (res.success && res.data && res.data.question_closed === true) {
        if (
          activeSessionIdRef.current &&
          sessionId === activeSessionIdRef.current &&
          snapshotRef.current?.current_question_id &&
          res.data.question_id === snapshotRef.current.current_question_id
        ) {
          if (res.data.total_questions) {
            setAuthoritativeTotalQuestions(res.data.total_questions);
          }
          setQuestionResults(res.data);
          setReviewedQuestionOrder(null);
          setReviewedQuestionResults(null);
          setHostViewMode('QUESTION_RESULTS');
          return { success: true, data: res.data };
        }
        return { success: false, error_code: 'QUESTION_ID_MISMATCH' };
      } else if (res.error_code === 'QUESTION_STILL_ACTIVE') {
        // Skew protection: Question still active on server, fail-closed without rapid retry loop
        return { success: false, error_code: 'QUESTION_STILL_ACTIVE' };
      }
      return { success: false, error_code: res.error_code || 'ERROR' };
    } catch (_err) {
      // Network error, fail closed
      return { success: false, error_code: 'NETWORK_ERROR' };
    } finally {
      isFetchingResultsRef.current = false;
      setIsResultsLoading(false);
    }
  }, []);

  // Historical Question Results Fetcher (Review Mode)
  const fetchHistoricalResult = useCallback(async (orderToFetch) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || isHistoricalResultsLoading) return { success: false };
    setIsHistoricalResultsLoading(true);
    try {
      const res = await getHostQuestionResultByOrder({
        sessionId,
        questionOrder: orderToFetch,
      });

      if (res.success && res.data) {
        if (res.data.total_questions) {
          setAuthoritativeTotalQuestions(res.data.total_questions);
        }
        setReviewedQuestionOrder(orderToFetch);
        setReviewedQuestionResults(res.data);
        setHostViewMode('QUESTION_RESULTS');
        return { success: true, data: res.data };
      } else {
        showToast(res.message || 'Không thể tải kết quả câu hỏi này.', 'error');
        return { success: false, error_code: res.error_code };
      }
    } catch (_err) {
      showToast('Lỗi mạng khi tải kết quả câu hỏi.', 'error');
      return { success: false, error_code: 'NETWORK_ERROR' };
    } finally {
      setIsHistoricalResultsLoading(false);
    }
  }, [isHistoricalResultsLoading, showToast]);

  const handleReviewPrevQuestion = useCallback(() => {
    const currentReviewOrder = reviewedQuestionOrder ?? snapshot?.current_question_index ?? 1;
    const targetOrder = currentReviewOrder - 1;
    if (targetOrder >= 1) {
      fetchHistoricalResult(targetOrder);
    }
  }, [reviewedQuestionOrder, snapshot?.current_question_index, fetchHistoricalResult]);

  const handleReviewNextQuestion = useCallback(() => {
    const currentReviewOrder = reviewedQuestionOrder ?? snapshot?.current_question_index ?? 1;
    const maxOrder = snapshot?.status === 'finished'
      ? (authoritativeTotalQuestions || createdQuestionCount || 1)
      : (snapshot?.current_question_index || 1);
    const targetOrder = currentReviewOrder + 1;
    if (targetOrder <= maxOrder) {
      if (
        snapshot?.status !== 'finished' &&
        targetOrder === snapshot?.current_question_index &&
        questionResults?.question_id === snapshot?.current_question_id
      ) {
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        setHostViewMode('QUESTION_RESULTS');
      } else {
        fetchHistoricalResult(targetOrder);
      }
    }
  }, [reviewedQuestionOrder, snapshot?.status, snapshot?.current_question_index, snapshot?.current_question_id, authoritativeTotalQuestions, createdQuestionCount, questionResults, fetchHistoricalResult]);

  const handleReturnToCurrentQuestion = useCallback(() => {
    setReviewedQuestionOrder(null);
    setReviewedQuestionResults(null);
    if (snapshot?.status === 'finished') {
      setHostViewMode('FINAL_RESULTS');
    } else if (questionResults && questionResults.question_id === snapshot?.current_question_id) {
      setHostViewMode('QUESTION_RESULTS');
    } else {
      setHostViewMode('LIVE_QUESTION');
    }
  }, [snapshot?.status, snapshot?.current_question_id, questionResults]);

  // Countdown Timer & Natural Expiry Detection (Local display only + bounded 2-attempt clock-skew auto fetch)
  useEffect(() => {
    if (!snapshot?.question_deadline || snapshot.status !== 'in_progress') {
      setTimeLeftSeconds(null);
      return;
    }

    const updateTimer = () => {
      const deadline = new Date(snapshot.question_deadline).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
      setTimeLeftSeconds(remaining);

      // When countdown reaches 0, trigger at most TWO bounded automatic attempts for clock skew
      if (remaining === 0 && hostViewMode === 'LIVE_QUESTION' && !isFetchingResultsRef.current && !questionResults) {
        const attemptKey = `${snapshot.current_question_id}:${snapshot.question_deadline}`;
        const guard = autoResultAttemptRef.current;

        if (!guard || guard.key !== attemptKey) {
          // Attempt #1 on initial countdown zero
          autoResultAttemptRef.current = {
            key: attemptKey,
            attempts: 1,
            canRetryOnSkew: false
          };
          fetchResultsSafely(activeSessionId).then((res) => {
            // Permit attempt #2 ONLY if attempt #1 specifically failed with QUESTION_STILL_ACTIVE
            if (autoResultAttemptRef.current?.key === attemptKey) {
              autoResultAttemptRef.current.canRetryOnSkew = (res?.error_code === 'QUESTION_STILL_ACTIVE');
            }
          });
        } else if (guard.attempts < 2 && guard.canRetryOnSkew) {
          // Attempt #2 on subsequent countdown tick for clock skew
          guard.attempts = 2;
          guard.canRetryOnSkew = false;
          fetchResultsSafely(activeSessionId);
        }
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [snapshot?.question_deadline, snapshot?.status, snapshot?.current_question_id, hostViewMode, questionResults, activeSessionId, fetchResultsSafely]);

  // Handle Question Builder Updates
  const handleAddQuestion = () => {
    if (questions.length >= MAX_COMPETITION_QUESTIONS) {
      showToast(`Chỉ được tạo tối đa ${MAX_COMPETITION_QUESTIONS} câu hỏi trong phiên thi này.`, 'warning');
      return;
    }
    const nextOrder = questions.length + 1;
    const newQ = {
      question_order: nextOrder,
      question_text: `Câu hỏi số ${nextOrder}`,
      question_type: 'single_choice',
      points: 10.00,
      time_limit_seconds: 30,
      options: [
        { id: 'opt_1', text: 'Phương án A' },
        { id: 'opt_2', text: 'Phương án B' },
        { id: 'opt_3', text: 'Phương án C' },
        { id: 'opt_4', text: 'Phương án D' }
      ],
      correct_answer: { option_id: 'opt_1' }
    };
    setQuestions([...questions, newQ]);
  };

  const handleRemoveQuestion = (orderIndex) => {
    if (questions.length <= 1) {
      showToast('Phải có ít nhất 1 câu hỏi trong phòng thi.', 'warning');
      return;
    }
    const filtered = questions
      .filter((_, idx) => idx !== orderIndex)
      .map((q, idx) => ({ ...q, question_order: idx + 1 }));
    setQuestions(filtered);
  };

  const handleUpdateQuestion = (index, field, value) => {
    const updated = [...questions];
    updated[index][field] = value;
    setQuestions(updated);
  };

  const handleUpdateOption = (qIndex, optIndex, textValue) => {
    const updated = [...questions];
    updated[qIndex].options[optIndex].text = textValue;
    setQuestions(updated);
  };

  const handleSelectCorrectOption = (qIndex, optionId) => {
    const updated = [...questions];
    updated[qIndex].correct_answer = { option_id: optionId };
    setQuestions(updated);
  };

  const handleToggleCorrectOptionMulti = (qIndex, optionId) => {
    const updated = [...questions];
    const q = updated[qIndex];
    const currentIds = Array.isArray(q.correct_answer?.option_ids) ? [...q.correct_answer.option_ids] : [];
    const exists = currentIds.includes(optionId);
    let nextIds;
    if (exists) {
      nextIds = currentIds.filter(id => id !== optionId);
    } else {
      nextIds = [...currentIds, optionId];
    }
    updated[qIndex].correct_answer = { option_ids: nextIds };
    setQuestions(updated);
  };

  const handleAddAcceptedAnswer = (qIndex) => {
    const updated = [...questions];
    const currentAnswers = Array.isArray(updated[qIndex].correct_answer?.accepted_answers)
      ? [...updated[qIndex].correct_answer.accepted_answers]
      : [''];
    currentAnswers.push('');
    updated[qIndex].correct_answer = {
      accepted_answers: currentAnswers
    };
    setQuestions(updated);
  };

  const handleRemoveAcceptedAnswer = (qIndex, ansIndex) => {
    const updated = [...questions];
    const currentAnswers = Array.isArray(updated[qIndex].correct_answer?.accepted_answers)
      ? [...updated[qIndex].correct_answer.accepted_answers]
      : [''];
    if (currentAnswers.length <= 1) return;
    currentAnswers.splice(ansIndex, 1);
    updated[qIndex].correct_answer = {
      accepted_answers: currentAnswers
    };
    setQuestions(updated);
  };

  const handleUpdateAcceptedAnswer = (qIndex, ansIndex, val) => {
    const updated = [...questions];
    const currentAnswers = Array.isArray(updated[qIndex].correct_answer?.accepted_answers)
      ? [...updated[qIndex].correct_answer.accepted_answers]
      : [''];
    currentAnswers[ansIndex] = val;
    updated[qIndex].correct_answer = {
      accepted_answers: currentAnswers
    };
    setQuestions(updated);
  };

  const handleQuestionTypeChange = (qIndex, newType) => {
    const updated = [...questions];
    const q = updated[qIndex];
    if (newType === 'fill_blank') {
      // Clear option-based answer key, initialize empty accepted_answers
      updated[qIndex] = {
        ...q,
        question_type: 'fill_blank',
        options: [],
        correct_answer: {
          accepted_answers: ['']
        }
      };
      showToast(`Đã chuyển Câu ${q.question_order} sang Điền vào chỗ trống. Vui lòng nhập đáp án được chấp nhận.`, 'info');
    } else if (newType === 'multiple_choice') {
      if (q.question_type === 'fill_blank') {
        updated[qIndex] = {
          ...q,
          question_type: 'multiple_choice',
          options: [
            { id: 'opt_1', text: 'Phương án A' },
            { id: 'opt_2', text: 'Phương án B' },
            { id: 'opt_3', text: 'Phương án C' },
            { id: 'opt_4', text: 'Phương án D' }
          ],
          correct_answer: {
            option_ids: ['opt_1']
          }
        };
        showToast(`Đã chuyển Câu ${q.question_order} sang Trắc nghiệm nhiều đáp án. Vui lòng chỉnh sửa các phương án lựa chọn.`, 'info');
      } else {
        const currentOptId = q.correct_answer?.option_id;
        const initialIds = currentOptId ? [currentOptId] : (Array.isArray(q.correct_answer?.option_ids) ? q.correct_answer.option_ids : []);
        updated[qIndex] = {
          ...q,
          question_type: 'multiple_choice',
          correct_answer: {
            option_ids: initialIds
          }
        };
      }
    } else if (newType === 'single_choice') {
      if (q.question_type === 'fill_blank') {
        updated[qIndex] = {
          ...q,
          question_type: 'single_choice',
          options: [
            { id: 'opt_1', text: 'Phương án A' },
            { id: 'opt_2', text: 'Phương án B' },
            { id: 'opt_3', text: 'Phương án C' },
            { id: 'opt_4', text: 'Phương án D' }
          ],
          correct_answer: {
            option_id: 'opt_1'
          }
        };
        showToast(`Đã chuyển Câu ${q.question_order} sang Trắc nghiệm 1 đáp án. Vui lòng chỉnh sửa các phương án lựa chọn.`, 'info');
      } else {
        const currentIds = Array.isArray(q.correct_answer?.option_ids) ? q.correct_answer.option_ids : [];
        if (currentIds.length === 1) {
          updated[qIndex] = {
            ...q,
            question_type: 'single_choice',
            correct_answer: {
              option_id: currentIds[0]
            }
          };
        } else {
          updated[qIndex] = {
            ...q,
            question_type: 'single_choice',
            correct_answer: {
              option_id: ''
            }
          };
          if (currentIds.length > 1) {
            showToast(`Câu ${q.question_order} có nhiều hơn 1 đáp án đúng. Vui lòng chọn lại 1 đáp án đúng duy nhất.`, 'warning');
          }
        }
      }
    }
    setQuestions(updated);
  };

  const handleImportFromBank = (newQuestions) => {
    if (!Array.isArray(newQuestions) || newQuestions.length === 0) return;
    const remaining = MAX_COMPETITION_QUESTIONS - questions.length;
    if (remaining <= 0) {
      showToast(`Đã đạt giới hạn tối đa ${MAX_COMPETITION_QUESTIONS} câu hỏi trong phòng thi.`, 'warning');
      return;
    }
    const toAdd = newQuestions.slice(0, remaining);
    const combined = [...questions, ...toAdd];
    setQuestions(reindexCompetitionQuestions(combined));
    showToast(`Đã thêm thành công ${toAdd.length} câu hỏi từ Ngân hàng!`, 'success');
  };

  const handleImportFromExcel = (newQuestions) => {
    if (!Array.isArray(newQuestions) || newQuestions.length === 0) return;
    const remaining = MAX_COMPETITION_QUESTIONS - questions.length;
    if (remaining <= 0) {
      showToast(`Đã đạt giới hạn tối đa ${MAX_COMPETITION_QUESTIONS} câu hỏi trong phòng thi.`, 'warning');
      return;
    }
    const toAdd = newQuestions.slice(0, remaining);
    const combined = [...questions, ...toAdd];
    setQuestions(reindexCompetitionQuestions(combined));
    showToast(`Đã nhập thành công ${toAdd.length} câu hỏi từ file Excel!`, 'success');
  };

  // Submit Handler for Session Creation
  const handleCreateSession = async (e) => {
    e.preventDefault();
    setSetupError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSetupError('Vui lòng nhập tên đấu trường.');
      return;
    }

    if (questions.length === 0) {
      setSetupError('Cần ít nhất một câu hỏi để tạo phòng thi.');
      return;
    }

    // Validate questions payload
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) {
        setSetupError(`Nội dung câu hỏi số ${i + 1} không được để trống.`);
        return;
      }
      if (q.question_type === 'fill_blank') {
        const accepted = Array.isArray(q.correct_answer?.accepted_answers)
          ? q.correct_answer.accepted_answers.map(s => String(s || '').trim()).filter(Boolean)
          : [];
        if (accepted.length === 0) {
          setSetupError(`Vui lòng nhập ít nhất 1 đáp án đúng cho câu hỏi số ${i + 1} (điền vào chỗ trống).`);
          return;
        }
      } else {
        for (let j = 0; j < (q.options || []).length; j++) {
          if (!q.options[j].text.trim()) {
            setSetupError(`Phương án ${j + 1} của câu hỏi ${i + 1} không được để trống.`);
            return;
          }
        }
        if (q.question_type === 'multiple_choice') {
          const optionIds = Array.isArray(q.correct_answer?.option_ids) ? q.correct_answer.option_ids : [];
          if (optionIds.length === 0) {
            setSetupError(`Vui lòng chọn ít nhất 1 đáp án đúng cho câu hỏi số ${i + 1} (trắc nghiệm nhiều đáp án).`);
            return;
          }
        } else {
          if (!q.correct_answer?.option_id) {
            setSetupError(`Vui lòng chọn đáp án đúng cho câu hỏi số ${i + 1}.`);
            return;
          }
        }
      }
    }

    setActionPending(true);
    try {
      const sanitizedQuestions = sanitizeQuestionsForCreation(questions);
      const res = await hostCreateSession({
        title: trimmedTitle,
        description: description.trim() || null,
        mode: 'individual',
        maxParticipants: parseInt(maxParticipants, 10) || 30,
        reviewEnabled: Boolean(reviewEnabled),
        questions: sanitizedQuestions
      });

      if (res.success && res.data?.session?.id) {
        const newSessionId = res.data.session.id;
        restoredSessionPendingValidationRef.current = false;
        activeSessionIdRef.current = newSessionId;
        setActiveSessionId(newSessionId);
        try {
          if (typeof window !== 'undefined' && isValidSessionUUID(newSessionId)) {
            window.sessionStorage?.setItem(HOST_SESSION_STORAGE_KEY, newSessionId);
          }
        } catch (_e) {}
        setCreatedQuestionCount(questions.length);
        setAuthoritativeTotalQuestions(questions.length);
        setSnapshot(res.data.session);
        setHostViewMode('LIVE_QUESTION');
        setQuestionResults(null);
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        autoResultAttemptRef.current = null;
        showToast('Tạo phòng thi thành công! Mã phòng đã sẵn sàng.', 'success');
      } else {
        setSetupError(res.message || 'Không thể tạo phòng thi. Vui lòng thử lại.');
      }
    } catch (err) {
      setSetupError(err.message || 'Lỗi mạng khi kết nối máy chủ.');
    } finally {
      setActionPending(false);
    }
  };

  // Host Lifecycle Actions
  const handleStartSession = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostStartSession(activeSessionId);
      if (res.success) {
        setHostViewMode('LIVE_QUESTION');
        setQuestionResults(null);
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        autoResultAttemptRef.current = null;
        showToast('Đã bắt đầu phòng thi! Câu hỏi đầu tiên đã kích hoạt.', 'success');
        await refreshNow();
      } else {
        showToast(res.message || 'Không thể bắt đầu phòng thi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi bắt đầu phòng thi.', 'error');
    } finally {
      setActionPending(false);
    }
  };

  const handlePauseSession = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostPauseSession(activeSessionId);
      if (res.success) {
        showToast('Đã tạm dừng đếm ngược câu hỏi.', 'info');
        await refreshNow();
      } else {
        showToast(res.message || 'Không thể tạm dừng phòng thi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi tạm dừng phòng thi.', 'error');
    } finally {
      setActionPending(false);
    }
  };

  const handleResumeSession = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostResumeSession(activeSessionId);
      if (res.success) {
        showToast('Đã tiếp tục phiên thi đấu.', 'success');
        await refreshNow();
      } else {
        showToast(res.message || 'Không thể tiếp tục phòng thi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi tiếp tục phòng thi.', 'error');
    } finally {
      setActionPending(false);
    }
  };

  const handleCloseQuestion = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostCloseQuestion(activeSessionId);
      if (res.success) {
        showToast('Đã kết thúc thời gian trả lời câu hỏi! Đang tải kết quả...', 'success');
        await refreshNow();
        await fetchResultsSafely(activeSessionId);
      } else {
        showToast(res.message || 'Không thể kết thúc câu hỏi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi kết thúc câu hỏi.', 'error');
    } finally {
      setActionPending(false);
    }
  };

  const handleNextQuestion = async () => {
    if (!activeSessionId || actionPending || isFinalQuestion) return;
    setActionPending(true);
    try {
      const res = await hostNextQuestion(activeSessionId);
      if (res.success) {
        setQuestionResults(null);
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        setHostViewMode('LIVE_QUESTION');
        autoResultAttemptRef.current = null;
        showToast('Đã chuyển sang câu hỏi tiếp theo!', 'success');
        await refreshNow();
        if (isLeaderboardOpen) {
          fetchLeaderboard();
        }
      } else {
        showToast(res.message || 'Không thể chuyển câu hỏi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi chuyển câu hỏi.', 'error');
    } finally {
      setActionPending(false);
    }
  };

  const handleFinishSession = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostFinishSession(activeSessionId);
      if (res.success) {
        setQuestionResults(null);
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        setTimeLeftSeconds(null);
        autoResultAttemptRef.current = null;
        showToast('Phòng thi đã kết thúc và tính toán thứ hạng hoàn tất!', 'success');
        await refreshNow();
        await fetchLeaderboard(activeSessionId);
        setHostViewMode('FINAL_RESULTS');
      } else {
        showToast(res.message || 'Không thể kết thúc phòng thi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi kết thúc phòng thi.', 'error');
    } finally {
      setActionPending(false);
      setConfirmModal(null);
    }
  };

  const handleCancelSession = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostCancelSession(activeSessionId);
      if (res.success) {
        setQuestionResults(null);
        setReviewedQuestionOrder(null);
        setReviewedQuestionResults(null);
        setHostViewMode('LIVE_QUESTION');
        autoResultAttemptRef.current = null;
        showToast('Đã hủy phòng thi thành công.', 'info');
        await refreshNow();
      } else {
        showToast(res.message || 'Không thể hủy phòng thi.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi hủy phòng thi.', 'error');
    } finally {
      setActionPending(false);
      setConfirmModal(null);
    }
  };

  const handleCopyRoomCode = (code) => {
    if (!code) return;
    navigator.clipboard?.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyInviteLink = (code) => {
    if (!code) return;
    const inviteUrl = `${window.location.origin}/competition/join?room=${encodeURIComponent(code)}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(inviteUrl);
    } else {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = inviteUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (_e) {}
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleOpenSpectator = (targetSessionId) => {
    const sId = targetSessionId || activeSessionId || snapshot?.id;
    if (!sId) return;
    const url = `/competition/spectator?sessionId=${encodeURIComponent(sId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };


  const handleResetToSetup = () => {
    clearRestoredSessionAndReturnToSetup();
  };

  // Helper status badge styling
  const renderStatusBadge = (st) => {
    switch (st) {
      case 'waiting':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300"><Clock className="w-3.5 h-3.5" /> Đang chờ học sinh vào phòng</span>;
      case 'in_progress':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse"><Play className="w-3.5 h-3.5" /> Đang thi đấu trực tiếp</span>;
      case 'paused':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-300"><Pause className="w-3.5 h-3.5" /> Tạm dừng đếm ngược</span>;
      case 'finished':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-300"><Trophy className="w-3.5 h-3.5" /> Đã hoàn thành</span>;
      case 'cancelled':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-300"><XCircle className="w-3.5 h-3.5" /> Đã hủy bỏ</span>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Normal On-Screen Competition Host UI (Hidden in Print Mode) */}
      <div className="py-8 px-4 sm:px-6 lg:px-8 print:hidden">
        <div className="max-w-6xl mx-auto space-y-6">

        {/* Top Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white shadow-md">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
                Bàn Điều Khiển Đấu Trường
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-100 text-sky-700">Host V1</span>
              </h1>
              <p className="text-sm text-slate-500">Quản trị và điều phối phòng thi đấu trực tiếp dành cho Giáo viên &amp; Admin</p>
            </div>
          </div>

          {activeSessionId && (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setIsLeaderboardOpen(!isLeaderboardOpen)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition shadow-sm ${
                  isLeaderboardOpen
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Bảng Xếp Hạng Nhanh
              </button>
              <button
                type="button"
                disabled={actionPending || isPollingLoading}
                onClick={refreshNow}
                title="Làm mới dữ liệu phòng thi"
                className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition"
              >
                <RefreshCw className={`w-4 h-4 ${isPollingLoading ? 'animate-spin text-amber-500' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {/* Toast / Notification Banner */}
        {notification && (
          <div
            className={`p-4 rounded-xl text-sm font-medium border flex items-center justify-between ${
              notification.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : notification.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : notification.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-sky-50 text-sky-800 border-sky-200'
            }`}
          >
            <span>{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-slate-600 ml-4 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Polling Error Notice */}
        {pollingError && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{pollingError}</span>
            </div>
            {activeSessionId && (
              <button
                type="button"
                onClick={handleResetToSetup}
                className="text-xs font-bold text-amber-900 underline hover:no-underline ml-2 flex-shrink-0"
              >
                Về trang tạo phòng
              </button>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* STATE A: SETUP SCREEN                                        */}
        {/* ============================================================ */}
        {currentStatus === 'setup' && (
          <form onSubmit={handleCreateSession} className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  1. Cấu hình thông tin phòng thi
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Thiết lập các thông số cơ bản trước khi mở sảnh chờ cho học sinh.</p>
              </div>

              {setupError && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{setupError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Tên Đấu Trường <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ví dụ: Đấu Trường Toán Học Lớp 5"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Số Người Tham Gia Tối Đa
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={maxParticipants}
                    onChange={(e) => setMaxParticipants(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Mô Tả Phòng Thi
                </label>
                <textarea
                  rows="2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ghi chú hoặc lời dặn dò học sinh..."
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                />
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
                <div className="flex items-center gap-4">
                  <span>Chế độ thi đấu: <strong className="text-slate-800">Cá nhân (Individual)</strong></span>
                  <span>Phần thưởng: <strong className="text-slate-800">Tắt (Off)</strong></span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700 font-medium">
                  <input
                    type="checkbox"
                    checked={reviewEnabled}
                    onChange={(e) => setReviewEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer border-slate-300"
                  />
                  <span>Cho phép học sinh xem lại bài làm sau khi kết thúc</span>
                </label>
              </div>
            </div>

            {/* Question Builder Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-sky-500" />
                    2. Soạn câu hỏi đấu trường ({questions.length}/{MAX_COMPETITION_QUESTIONS} câu)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Hỗ trợ trắc nghiệm 1 đáp án hoặc nhiều đáp án (tối đa {MAX_COMPETITION_QUESTIONS} câu).</p>
                </div>

                <div className="relative">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                      disabled={questions.length >= MAX_COMPETITION_QUESTIONS}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 text-white font-semibold text-xs hover:bg-sky-700 disabled:opacity-50 transition shadow-xs"
                    >
                      <Plus className="w-4 h-4" />
                      Thêm Câu Hỏi
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isAddMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {isAddMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-30 animate-fadeIn">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          handleAddQuestion();
                        }}
                        disabled={questions.length >= MAX_COMPETITION_QUESTIONS}
                        className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-sky-50 hover:text-sky-700 flex items-center gap-2.5 disabled:opacity-40 transition"
                      >
                        <Plus className="w-4 h-4 text-sky-500 shrink-0" />
                        <span>Tạo câu hỏi mới</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          setIsQuestionBankModalOpen(true);
                        }}
                        disabled={questions.length >= MAX_COMPETITION_QUESTIONS}
                        className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-700 flex items-center gap-2.5 disabled:opacity-40 transition"
                      >
                        <BookOpen className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>Chọn từ Ngân hàng</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          setIsImportExcelModalOpen(true);
                        }}
                        disabled={questions.length >= MAX_COMPETITION_QUESTIONS}
                        className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2.5 disabled:opacity-40 transition"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Nhập từ file Excel</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                {questions.map((q, qIdx) => (
                  <div key={qIdx} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-lg bg-amber-500 text-white font-bold text-xs shadow-sm">
                          Câu {q.question_order}
                        </span>
                        <select
                          value={q.question_type || 'single_choice'}
                          onChange={(e) => handleQuestionTypeChange(qIdx, e.target.value)}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-semibold bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        >
                          <option value="single_choice">Trắc nghiệm 1 đáp án</option>
                          <option value="multiple_choice">Trắc nghiệm nhiều đáp án</option>
                          <option value="fill_blank">Điền vào chỗ trống</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>Thời gian:</span>
                          <input
                            type="number"
                            min="5"
                            max="600"
                            value={q.time_limit_seconds}
                            onChange={(e) => handleUpdateQuestion(qIdx, 'time_limit_seconds', e.target.value)}
                            className="w-16 px-2 py-1 rounded border border-slate-300 text-xs bg-white text-center"
                          />
                          <span>giây</span>
                        </div>

                        {questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestion(qIdx)}
                            className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition"
                            title="Xóa câu hỏi này"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <input
                        type="text"
                        required
                        value={q.question_text}
                        onChange={(e) => handleUpdateQuestion(qIdx, 'question_text', e.target.value)}
                        placeholder={`Nhập nội dung câu hỏi số ${q.question_order}...`}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm bg-white font-medium"
                      />
                    </div>

                    {/* Question Answers: Fill Blank vs Choice */}
                    {q.question_type === 'fill_blank' ? (
                      <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                              Đáp án đúng được chấp nhận <span className="text-red-500">*</span>
                            </label>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Có thể nhập nhiều đáp án tương đương. Hệ thống không phân biệt chữ hoa/thường và bỏ khoảng trắng thừa ở đầu/cuối.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddAcceptedAnswer(qIdx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 transition self-start sm:self-auto cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Thêm đáp án
                          </button>
                        </div>

                        <div className="space-y-2 pt-1">
                          {(q.correct_answer?.accepted_answers || ['']).map((ans, aIdx) => (
                            <div key={aIdx} className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-400 w-6">#{aIdx + 1}</span>
                              <input
                                type="text"
                                required={aIdx === 0}
                                value={ans}
                                onChange={(e) => handleUpdateAcceptedAnswer(qIdx, aIdx, e.target.value)}
                                placeholder={aIdx === 0 ? 'Nhập đáp án chính (bắt buộc)...' : 'Nhập đáp án tương đương khác...'}
                                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm bg-white font-medium focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />
                              {(q.correct_answer?.accepted_answers || []).length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAcceptedAnswer(qIdx, aIdx)}
                                  className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition cursor-pointer"
                                  title="Xóa đáp án này"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* Options List for Choice-based questions */
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Array.isArray(q.options) && q.options.map((opt, optIdx) => {
                          const isMulti = q.question_type === 'multiple_choice';
                          const isCorrect = isMulti
                            ? (Array.isArray(q.correct_answer?.option_ids) && q.correct_answer.option_ids.includes(opt.id))
                            : (q.correct_answer?.option_id === opt.id);
                          const labelChar = String.fromCharCode(65 + optIdx); // A, B, C, D

                          return (
                            <div
                              key={opt.id}
                              className={`p-2.5 rounded-xl border transition flex items-center gap-2 ${
                                isCorrect
                                  ? 'bg-emerald-50/80 border-emerald-400 ring-1 ring-emerald-400'
                                  : 'bg-white border-slate-200'
                              }`}
                            >
                              {isMulti ? (
                                <input
                                  type="checkbox"
                                  checked={isCorrect}
                                  onChange={() => handleToggleCorrectOptionMulti(qIdx, opt.id)}
                                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                                  title="Đánh dấu phương án này là một đáp án đúng"
                                />
                              ) : (
                                <input
                                  type="radio"
                                  name={`correct_q_${qIdx}`}
                                  checked={isCorrect}
                                  onChange={() => handleSelectCorrectOption(qIdx, opt.id)}
                                  className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                  title="Đánh dấu đây là đáp án đúng"
                                />
                              )}
                              <span className="font-bold text-xs text-slate-500 w-5">{labelChar}.</span>
                              <input
                                type="text"
                                required
                                value={opt.text}
                                onChange={(e) => handleUpdateOption(qIdx, optIdx, e.target.value)}
                                placeholder={`Phương án ${labelChar}`}
                                className="flex-1 px-2 py-1 rounded border-0 bg-transparent text-sm focus:outline-none text-slate-800"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="submit"
                  disabled={actionPending}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold text-sm shadow-md hover:from-amber-600 hover:to-amber-700 transition disabled:opacity-50"
                >
                  {actionPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang khởi tạo phòng thi...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Tạo Đấu Trường &amp; Mở Sảnh Chờ
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ============================================================ */}
        {/* STATE B: LOBBY SCREEN (WAITING)                              */}
        {/* ============================================================ */}
        {currentStatus === 'waiting' && snapshot && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {renderStatusBadge(snapshot.status)}
                    <span className="text-xs text-slate-400">ID: {snapshot.id.slice(0, 8)}...</span>
                  </div>
                    <button
                      type="button"
                      onClick={() => handleOpenSpectator(snapshot.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-800 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-xl border border-sky-300 shadow-xs transition-colors"
                      title="Mở màn hình trình chiếu máy chiếu"
                    >
                      <Tv className="w-3.5 h-3.5 text-sky-600" />
                      Trình Chiếu Trực Tiếp
                    </button>
                  <h2 className="text-2xl font-extrabold text-slate-800">{snapshot.title}</h2>
                  {snapshot.description && (
                    <p className="text-xs text-slate-500 mt-1">{snapshot.description}</p>
                  )}
                </div>

                {/* Room Code Card */}
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/60 border border-amber-300 rounded-2xl p-4 text-center min-w-[200px] shadow-sm">
                  <span className="text-xs font-bold text-amber-800 uppercase tracking-widest block">Mã Phòng Thi</span>
                  <div className="text-3xl font-black text-amber-700 tracking-wider my-1 font-mono">
                    {snapshot.room_code}
                  </div>
                  <div className="flex items-center justify-center gap-2 flex-wrap mt-2">
                    <button
                      type="button"
                      onClick={() => handleCopyRoomCode(snapshot.room_code)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-white/80 px-2.5 py-1 rounded-lg border border-amber-300 shadow-xs transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedCode ? 'Đã sao chép!' : 'Sao chép mã'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyInviteLink(snapshot.room_code)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-white/80 px-2.5 py-1 rounded-lg border border-amber-300 shadow-xs transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      {copiedLink ? 'Đã sao chép link!' : 'Sao chép link mời'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenSpectator(snapshot.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 px-2.5 py-1 rounded-lg border border-sky-300 shadow-xs transition-colors"
                      title="Mở màn hình trình chiếu máy chiếu"
                    >
                      <Tv className="w-3 h-3 text-sky-600" />
                      Màn hình trình chiếu
                    </button>
                  </div>
                </div>
              </div>

              {/* Participant Summary */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Users className="w-4 h-4 text-sky-500" />
                    Danh Sách Thí Sinh Đã Tham Gia ({participants.length} / {snapshot.max_participants})
                  </h3>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
                    Tự động đồng bộ mỗi 3 giây
                  </span>
                </div>

                {participants.length === 0 ? (
                  <div className="text-center py-10 px-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                    <Users className="w-10 h-10 text-slate-400 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-semibold text-slate-600">Chưa có học sinh nào vào phòng</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Chia sẻ mã phòng <strong className="font-mono text-slate-700">{snapshot.room_code}</strong> để học sinh tham gia sảnh chờ.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {participants.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-2xs"
                      >
                        <div className="w-8 h-8 rounded-full bg-amber-500 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">
                          {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-800 truncate">{p.display_name}</p>
                          <span className="text-[10px] text-emerald-600 font-medium block">
                            {p.status === 'joined' ? 'Đã vào phòng' : p.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Lobby Action Controls */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={actionPending}
                  onClick={() => setConfirmModal({
                    type: 'cancel',
                    title: 'Xác nhận hủy phòng thi',
                    message: 'Bạn có chắc chắn muốn hủy phòng thi này? Tất cả học sinh đang chờ sẽ bị ngắt kết nối.',
                    onConfirm: handleCancelSession
                  })}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition disabled:opacity-50"
                >
                  Hủy Phòng Thi
                </button>

                <button
                  type="button"
                  disabled={actionPending || participants.length === 0}
                  onClick={handleStartSession}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  Bắt Đầu Trận Đấu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STATE C & D: IN_PROGRESS / PAUSED ACTIVE CONTROLLER          */}
        {/* ============================================================ */}
        {(currentStatus === 'in_progress' || currentStatus === 'paused') && snapshot && (
          <div className="space-y-6">
            {/* Live Status Bar & View Mode Switcher */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {renderStatusBadge(snapshot.status)}
                    <span className="text-xs font-mono font-bold bg-slate-100 px-2.5 py-0.5 rounded text-slate-700">
                      Mã phòng: {snapshot.room_code}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">{snapshot.title}</h2>
                </div>

                <div className="flex items-center gap-4">
                  {/* Countdown Timer Display */}
                  {timeLeftSeconds !== null && currentStatus === 'in_progress' && (
                    <div className="text-right bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 shadow-2xs">
                      <span className="text-[10px] text-amber-700 font-bold uppercase tracking-wider block">Thời Gian</span>
                      <span className="text-lg font-black text-amber-800 font-mono">
                        {timeLeftSeconds}s
                      </span>
                    </div>
                  )}

                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">Tiến độ câu hỏi</span>
                    <span className="text-lg font-black text-sky-700">
                      Câu {snapshot.current_question_index || 1} / {effectiveTotalQuestions}
                    </span>
                  </div>
                  <div className="text-right border-l border-slate-200 pl-4">
                    <span className="text-xs text-slate-400 block">Thí sinh</span>
                    <span className="text-lg font-black text-slate-800">
                      {participants.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* View Mode Navigation Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <button
                  type="button"
                  onClick={() => setHostViewMode('LIVE_QUESTION')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    hostViewMode === 'LIVE_QUESTION'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  Đang Thi Đấu
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (questionResults) {
                      setHostViewMode('QUESTION_RESULTS');
                    } else {
                      fetchResultsSafely(activeSessionId);
                    }
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    hostViewMode === 'QUESTION_RESULTS'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Kết Quả Câu Hỏi
                  {(isResultsLoading || isHistoricalResultsLoading) && <RefreshCw className="w-3 h-3 animate-spin ml-1" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setHostViewMode('LEADERBOARD');
                    fetchLeaderboard();
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    hostViewMode === 'LEADERBOARD'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  Bảng Xếp Hạng Trực Tiếp
                </button>
              </div>

              {/* Host Control Actions Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {currentStatus === 'in_progress' ? (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handlePauseSession}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
                  >
                    <Pause className="w-4 h-4" />
                    Tạm Dừng
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handleResumeSession}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
                  >
                    <Play className="w-4 h-4" />
                    Tiếp Tục
                  </button>
                )}

                {/* Close Question Early Button (R2) */}
                <button
                  type="button"
                  disabled={actionPending || currentStatus !== 'in_progress'}
                  onClick={handleCloseQuestion}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
                  title="Đóng câu hỏi hiện tại và hiển thị kết quả ngay"
                >
                  <StopCircle className="w-4 h-4" />
                  Kết Thúc Câu
                </button>

                {isFinalQuestion ? (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={() => setConfirmModal({
                      type: 'finish',
                      title: 'Xác nhận kết thúc phòng thi',
                      message: 'Đây là câu cuối cùng. Bạn có muốn kết thúc trận đấu và tính bảng xếp hạng chung cuộc không?',
                      onConfirm: handleFinishSession
                    })}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Kết Thúc Trận
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handleNextQuestion}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
                  >
                    <SkipForward className="w-4 h-4" />
                    Câu Tiếp Theo
                  </button>
                )}

                <button
                  type="button"
                  disabled={actionPending}
                  onClick={() => setConfirmModal({
                    type: 'finish',
                    title: 'Xác nhận kết thúc phòng thi',
                    message: 'Bạn có chắc chắn muốn kết thúc trận đấu ngay bây giờ và tính toán thứ hạng chung cuộc?',
                    onConfirm: handleFinishSession
                  })}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Kết Thúc Sớm
                </button>

                <button
                  type="button"
                  disabled={actionPending}
                  onClick={() => setConfirmModal({
                    type: 'cancel',
                    title: 'Xác nhận hủy phòng thi',
                    message: 'Bạn có chắc chắn muốn hủy phòng thi này? Trận đấu sẽ bị dừng ngay lập tức.',
                    onConfirm: handleCancelSession
                  })}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-red-300 text-red-600 hover:bg-red-50 font-bold text-xs transition disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Hủy Trận
                </button>
              </div>
            </div>

            {/* ============================================================ */}
            {/* VIEW MODE 1: LIVE_QUESTION (Real-time Submission Stats S2)    */}
            {/* ============================================================ */}
            {hostViewMode === 'LIVE_QUESTION' && isSubmissionStatsAuthoritative && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <Users className="w-5 h-5 text-sky-500" />
                      Tiến Độ Nộp Bài Câu Hiện Tại
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Thống kê thời gian thực số lượng thí sinh đã nộp câu trả lời cho Câu {snapshot.current_question_index || 1}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700">
                      Đã nộp: {submittedCount} / {totalEligible}
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-700">
                      Chưa nộp: {notSubmittedCount}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
                    <span>Tỷ lệ hoàn thành</span>
                    <span className="font-bold text-sky-600">{progressPercentage}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200">
                    <div
                      className="bg-gradient-to-r from-sky-500 to-emerald-500 h-full rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>

                {/* Two Compact Lists: Submitted & Not Submitted */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* List 1: Submitted */}
                  <div className="border border-emerald-200 bg-emerald-50/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                      <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        Đã nộp ({submittedList.length})
                      </span>
                      <span className="text-[11px] text-emerald-600 font-medium">Hoàn thành</span>
                    </div>

                    {submittedList.length === 0 ? (
                      <div className="text-center py-6 text-xs text-slate-400 italic">
                        Chưa có thí sinh nào nộp bài cho câu hỏi này
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {submittedList.map((p) => (
                          <div
                            key={p.participant_id}
                            className="p-2.5 bg-white rounded-lg border border-emerald-100 flex items-center justify-between shadow-2xs text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">
                                {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 truncate">{p.display_name}</p>
                                <span className="text-[10px] text-slate-400 block">{p.status}</span>
                              </div>
                            </div>

                            {p.submitted_at && (
                              <span className="text-[11px] text-emerald-600 font-mono flex items-center gap-1 flex-shrink-0">
                                <Clock className="w-3 h-3 text-emerald-500" />
                                {new Date(p.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* List 2: Not Submitted */}
                  <div className="border border-amber-200 bg-amber-50/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                      <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-amber-600" />
                        Chưa nộp ({notSubmittedList.length})
                      </span>
                      <span className="text-[11px] text-amber-600 font-medium">Đang suy nghĩ</span>
                    </div>

                    {notSubmittedList.length === 0 ? (
                      <div className="text-center py-6 text-xs text-emerald-600 font-semibold">
                        🎉 Tất cả thí sinh đã nộp bài!
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {notSubmittedList.map((p) => (
                          <div
                            key={p.participant_id}
                            className="p-2.5 bg-white rounded-lg border border-amber-100 flex items-center justify-between shadow-2xs text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-slate-400 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">
                                {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 truncate">{p.display_name}</p>
                                <span className="text-[10px] text-slate-400 block">{p.status}</span>
                              </div>
                            </div>

                            <span className="text-[11px] text-amber-600 font-medium flex-shrink-0">
                              Chưa nộp
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW MODE 2: QUESTION_RESULTS (Kahoot-style R2 + R12 Review) */}
            {/* ============================================================ */}
            {hostViewMode === 'QUESTION_RESULTS' && (
              <div className="space-y-6">
                {isQuestionResultsAuthoritative && activeDisplayedResults ? (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
                    {/* Historical Review Badge & Return Button */}
                    {isReviewingHistory && (
                      <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 text-indigo-900 font-bold">
                          <Clock className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                          <span>Đang xem lại kết quả Câu {activeDisplayedOrder} — chỉ xem</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleReturnToCurrentQuestion}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-xs flex-shrink-0"
                        >
                          Trở Về Câu Hiện Tại
                        </button>
                      </div>
                    )}

                    {/* Header & Question Text with Review Navigation */}
                    <div className="border-b border-slate-100 pb-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {/* ← Câu Trước */}
                          <button
                            type="button"
                            disabled={isHistoricalResultsLoading || activeDisplayedOrder <= 1}
                            onClick={handleReviewPrevQuestion}
                            className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
                            title="Xem kết quả câu hỏi trước"
                          >
                            ← Câu Trước
                          </button>

                          <span className="px-3 py-1 rounded-lg bg-amber-500 text-white font-bold text-xs shadow-sm">
                            Kết Quả Câu {activeDisplayedOrder} / {effectiveTotalQuestions}
                          </span>

                          {/* Câu Sau → */}
                          <button
                            type="button"
                            disabled={
                              isHistoricalResultsLoading ||
                              (snapshot?.status === 'finished'
                                ? activeDisplayedOrder >= effectiveTotalQuestions
                                : activeDisplayedOrder >= (snapshot?.current_question_index || 1))
                            }
                            onClick={handleReviewNextQuestion}
                            className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
                            title="Xem kết quả câu hỏi sau"
                          >
                            Câu Sau →
                          </button>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="bg-slate-100 px-2.5 py-1 rounded-lg font-semibold text-slate-700">
                            {activeDisplayedResults.question_type === 'single_choice' && 'Trắc nghiệm 1 đáp án'}
                            {activeDisplayedResults.question_type === 'multiple_choice' && 'Trắc nghiệm nhiều đáp án'}
                            {activeDisplayedResults.question_type === 'true_false' && 'Đúng / Sai'}
                            {(activeDisplayedResults.question_type === 'short_answer' || activeDisplayedResults.question_type === 'fill_blank') && 'Điền vào chỗ trống'}
                          </span>
                          <span className="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-lg font-bold">
                            {activeDisplayedResults.points} điểm
                          </span>
                        </div>
                      </div>

                      <h3 className="text-lg sm:text-xl font-bold text-slate-800 pt-1">
                        {activeDisplayedResults.question_text}
                      </h3>
                    </div>

                    {/* 4 Metric Summary Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {/* Submitted vs Eligible */}
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="text-xs text-slate-500 font-medium block">Số bài nộp</span>
                        <span className="text-xl font-black text-slate-800 mt-1 block">
                          {activeDisplayedResults.submitted_count} <span className="text-xs font-semibold text-slate-400">/ {activeDisplayedResults.total_eligible}</span>
                        </span>
                        <span className="text-[11px] text-slate-400 block mt-0.5">
                          Chưa nộp: {activeDisplayedResults.unanswered_count}
                        </span>
                      </div>

                      {/* Correct Count */}
                      <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                        <span className="text-xs text-emerald-700 font-medium block flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Trả lời đúng
                        </span>
                        <span className="text-xl font-black text-emerald-800 mt-1 block">
                          {activeDisplayedResults.correct_count}
                        </span>
                        <span className="text-[11px] text-emerald-600 block mt-0.5">
                          Thí sinh đạt điểm
                        </span>
                      </div>

                      {/* Incorrect Count */}
                      <div className="p-4 bg-red-50 rounded-xl border border-red-200">
                        <span className="text-xs text-red-700 font-medium block flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> Trả lời sai
                        </span>
                        <span className="text-xl font-black text-red-800 mt-1 block">
                          {activeDisplayedResults.incorrect_count}
                        </span>
                        <span className="text-[11px] text-red-600 block mt-0.5">
                          Chưa có điểm
                        </span>
                      </div>

                      {/* Correct Percentage */}
                      <div className="p-4 bg-sky-50 rounded-xl border border-sky-200">
                        <span className="text-xs text-sky-700 font-medium block">Tỷ lệ đúng</span>
                        <span className="text-xl font-black text-sky-800 mt-1 block">
                          {activeDisplayedResults.correct_percentage}%
                        </span>
                        <div className="w-full bg-sky-200 rounded-full h-1.5 mt-1.5 overflow-hidden">
                          <div
                            className="bg-sky-600 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, activeDisplayedResults.correct_percentage)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Answer Distribution Bars */}
                    {activeDisplayedResults.question_type !== 'short_answer' && Array.isArray(activeDisplayedResults.distribution) && (
                      <div className="space-y-4 pt-2">
                        <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                          <PieChart className="w-4 h-4 text-amber-500" />
                          Phân Bổ Lựa Chọn Của Thí Sinh
                        </h4>

                        <div className="space-y-3">
                          {activeDisplayedResults.distribution.map((opt, optIdx) => {
                            const labelChar = String.fromCharCode(65 + optIdx);
                            const isCorrect = opt.is_correct_option;

                            return (
                              <div
                                key={opt.option_id || optIdx}
                                className={`p-4 rounded-xl border transition space-y-2 ${
                                  isCorrect
                                    ? 'bg-emerald-50/60 border-emerald-400 ring-1 ring-emerald-300'
                                    : 'bg-slate-50/80 border-slate-200'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                                      isCorrect
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-200 text-slate-700'
                                    }`}>
                                      {labelChar}
                                    </span>
                                    <span className="font-semibold text-sm text-slate-800 truncate">
                                      {opt.option_text}
                                    </span>
                                    {isCorrect && (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300 flex-shrink-0">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                        Đáp án đúng
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-right flex-shrink-0">
                                    <span className="text-xs font-extrabold text-slate-800">
                                      {opt.selection_count} lượt chọn
                                    </span>
                                    <span className="text-[11px] text-slate-500 ml-1.5 font-mono">
                                      ({opt.selection_percentage}%)
                                    </span>
                                  </div>
                                </div>

                                {/* Option Percentage Bar */}
                                <div className="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      isCorrect ? 'bg-emerald-500' : 'bg-slate-400'
                                    }`}
                                    style={{ width: `${Math.min(100, opt.selection_percentage)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Short Answer Notice */}
                    {activeDisplayedResults.question_type === 'short_answer' && (
                      <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs space-y-1.5">
                        <p className="font-bold flex items-center gap-1.5 text-sm">
                          <CheckCircle className="w-4 h-4 text-sky-600" />
                          Câu hỏi điền vào chỗ trống
                        </p>
                        <p className="text-sky-700">
                          Đã ghi nhận {activeDisplayedResults.submitted_count} lượt nộp câu trả lời ({activeDisplayedResults.correct_count} đúng, {activeDisplayedResults.incorrect_count} sai). Hệ thống bảo mật không công khai nội dung chi tiết từng bài làm.
                        </p>
                        {Array.isArray(activeDisplayedResults.correct_answer?.accepted_answers) && activeDisplayedResults.correct_answer.accepted_answers.length > 0 && (
                          <div className="pt-1">
                            <span className="font-bold text-slate-700">Các đáp án được chấp nhận: </span>
                            <span className="font-mono text-emerald-700 font-bold">
                              {activeDisplayedResults.correct_answer.accepted_answers.join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bottom Action Controls */}
                    <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setHostViewMode('LEADERBOARD');
                          fetchLeaderboard();
                        }}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-xs border border-indigo-200 transition"
                      >
                        <Trophy className="w-4 h-4 text-amber-500" />
                        Xem Bảng Xếp Hạng
                      </button>

                      {isReviewingHistory ? (
                        <button
                          type="button"
                          onClick={handleReturnToCurrentQuestion}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md transition"
                        >
                          <ArrowRight className="w-4 h-4 rotate-180" />
                          Trở Về Câu Hiện Tại
                        </button>
                      ) : isFinalQuestion ? (
                        <button
                          type="button"
                          disabled={actionPending}
                          onClick={() => setConfirmModal({
                            type: 'finish',
                            title: 'Xác nhận kết thúc phòng thi',
                            message: 'Đây là câu cuối cùng. Bạn có muốn kết thúc trận đấu và tính bảng xếp hạng chung cuộc không?',
                            onConfirm: handleFinishSession
                          })}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition disabled:opacity-50"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Kết Thúc Trận
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={actionPending}
                          onClick={handleNextQuestion}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-md transition disabled:opacity-50"
                        >
                          <SkipForward className="w-4 h-4" />
                          Câu Tiếp Theo
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
                    <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 mx-auto">
                      <Clock className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-bold text-slate-800">
                      {isResultsLoading || isHistoricalResultsLoading ? 'Đang tải kết quả câu hỏi...' : 'Câu hỏi đang diễn ra hoặc chưa có kết quả'}
                    </h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Kết quả và biểu đồ phân bổ đáp án sẽ tự động mở khi hết thời gian đếm ngược hoặc khi Host bấm "Kết Thúc Câu".
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => fetchResultsSafely(activeSessionId)}
                        disabled={isResultsLoading || isHistoricalResultsLoading}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white font-bold text-xs hover:bg-amber-600 shadow-sm transition disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${(isResultsLoading || isHistoricalResultsLoading) ? 'animate-spin' : ''}`} />
                        Kiểm Tra &amp; Mở Kết Quả
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW MODE 3: LEADERBOARD                                     */}
            {/* ============================================================ */}
            {hostViewMode === 'LEADERBOARD' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-amber-500" />
                      Bảng Xếp Hạng Trực Tiếp
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Thứ hạng thí sinh dựa trên tổng điểm và thời gian phản hồi</p>
                  </div>

                  <button
                    type="button"
                    disabled={isLeaderboardLoading}
                    onClick={fetchLeaderboard}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLeaderboardLoading ? 'animate-spin text-amber-500' : ''}`} />
                    Làm mới
                  </button>
                </div>

                {leaderboardData.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-400">
                    Chưa có điểm số nào được ghi nhận.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                    {leaderboardData.map((item) => (
                      <div key={item.participant_id} className="p-3.5 flex items-center justify-between bg-white hover:bg-slate-50 transition">
                        <div className="flex items-center gap-3">
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            item.rank === 1
                              ? 'bg-amber-400 text-white'
                              : item.rank === 2
                              ? 'bg-slate-300 text-slate-700'
                              : item.rank === 3
                              ? 'bg-amber-700 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            {item.rank <= 3 ? <Crown className="w-3.5 h-3.5" /> : item.rank}
                          </span>
                          <div>
                            <span className="text-sm font-bold text-slate-800 block">{item.display_name}</span>
                            <span className="text-[11px] text-slate-400">Đúng {item.correct_count || 0} câu</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-extrabold text-amber-600 block">{item.total_score || 0} điểm</span>
                          <span className="text-[10px] text-slate-400">{((item.total_response_time_ms || 0) / 1000).toFixed(1)}s</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bottom Navigation for Leaderboard */}
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (questionResults) {
                        setHostViewMode('QUESTION_RESULTS');
                      } else {
                        setHostViewMode('LIVE_QUESTION');
                      }
                    }}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-xs transition"
                  >
                    <ArrowRight className="w-4 h-4 rotate-180" />
                    Quay Lại Bàn Điều Khiển
                  </button>

                  {isFinalQuestion ? (
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => setConfirmModal({
                        type: 'finish',
                        title: 'Xác nhận kết thúc phòng thi',
                        message: 'Đây là câu cuối cùng. Bạn có muốn kết thúc trận đấu và tính bảng xếp hạng chung cuộc không?',
                        onConfirm: handleFinishSession
                      })}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Kết Thúc Trận
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={handleNextQuestion}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-md transition disabled:opacity-50"
                    >
                      <SkipForward className="w-4 h-4" />
                      Câu Tiếp Theo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* STATE E: FINISHED SCREEN & PODIUM CEREMONY (FINAL_RESULTS)   */}
        {/* ============================================================ */}
        {currentStatus === 'finished' && snapshot && (
          <div className="space-y-6">
            {/* Top Banner with Trophy & Session Meta */}
            <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-black/10 rounded-full blur-2xl pointer-events-none" />

              <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white shadow-inner flex-shrink-0">
                    <Trophy className="w-10 h-10 text-amber-200 animate-pulse" />
                  </div>
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white/20 backdrop-blur-xs text-white border border-white/30">
                      <Crown className="w-3.5 h-3.5 text-amber-200" />
                      Lễ Trao Giải &amp; Bục Vinh Danh
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{snapshot.title}</h2>
                    <p className="text-xs sm:text-sm text-amber-100/90">
                      Mã phòng: <span className="font-mono font-bold text-white bg-black/20 px-2 py-0.5 rounded">{snapshot.room_code}</span> • Tổng số thí sinh: <span className="font-bold text-white">{participants.length}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => handleOpenSpectator(snapshot.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-white hover:text-white bg-white/20 hover:bg-white/30 px-3.5 py-2 rounded-xl border border-white/30 shadow-sm transition-colors"
                    title="Mở màn hình vinh danh kết quả"
                  >
                    <Tv className="w-4 h-4" />
                    Trình Chiếu Kết Quả
                  </button>
                  <HostExportControls
                    sessionTitle={snapshot.title}
                    roomCode={snapshot.room_code}
                    leaderboardData={leaderboardData}
                    analyticsData={exportAnalyticsData}
                    isAnonymized={isAnonymizedExport}
                    onAnonymizedChange={setIsAnonymizedExport}
                    exportTopN={exportTopN}
                    onExportTopNChange={setExportTopN}
                    printOrientation={printOrientation}
                    onPrintOrientationChange={setPrintOrientation}
                  />
                  <button
                    type="button"
                    disabled={isLeaderboardLoading}
                    onClick={() => fetchLeaderboard(activeSessionId)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs backdrop-blur-xs border border-white/30 transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLeaderboardLoading ? 'animate-spin' : ''}`} />
                    Làm Mới
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToSetup}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-900 font-bold text-xs hover:bg-slate-100 shadow-md transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Tạo Đấu Trường Mới
                  </button>
                </div>
              </div>
            </div>

            {/* R7 Sub-Navigation Tabs: Kết Quả Chung vs Phân Tích Câu Hỏi */}
            <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200 w-fit max-w-full">
              <button
                type="button"
                onClick={() => setFinishedTab('PODIUM')}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs ${
                  finishedTab === 'PODIUM'
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
                aria-pressed={finishedTab === 'PODIUM'}
              >
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>Kết Quả Chung</span>
              </button>

              <button
                type="button"
                onClick={() => setFinishedTab('ANALYTICS')}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs ${
                  finishedTab === 'ANALYTICS'
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
                aria-pressed={finishedTab === 'ANALYTICS'}
              >
                <BarChart3 className="w-4 h-4 text-sky-500" />
                <span>Phân Tích Câu Hỏi</span>
              </button>
            </div>

            {/* TAB 1: KẾT QUẢ CHUNG (BỤC VINH DANH & BẢNG XẾP HẠNG) */}
            {finishedTab === 'PODIUM' && (
              <>
                {/* Error State Banner */}
            {leaderboardError && leaderboardData.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-8 text-center space-y-4">
                <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mx-auto border border-red-200">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Không thể tải dữ liệu bảng xếp hạng</h3>
                  <p className="text-xs text-red-600 mt-1">{leaderboardError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchLeaderboard(activeSessionId)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-md transition"
                >
                  <RefreshCw className="w-4 h-4" />
                  Thử Lại Ngay
                </button>
              </div>
            )}

            {/* Loading State Banner */}
            {isLeaderboardLoading && leaderboardData.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center space-y-4">
                <RefreshCw className="w-10 h-10 text-amber-500 animate-spin mx-auto" />
                <h3 className="text-lg font-bold text-slate-800">Đang tải bảng xếp hạng chung cuộc...</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">Hệ thống đang đồng bộ điểm số và tính toán thứ hạng chính thức từ máy chủ.</p>
              </div>
            )}

            {/* Empty State Banner (0 Participants) */}
            {!isLeaderboardLoading && !leaderboardError && leaderboardData.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center space-y-4">
                <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mx-auto">
                  <Users className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-700">Chưa có dữ liệu thí sinh</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">Không có kết quả nộp bài hoặc không có thí sinh nào tham gia phiên thi này.</p>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fetchLeaderboard(activeSessionId)}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold"
                  >
                    Tải Lại
                  </button>
                </div>
              </div>
            )}

            {/* Main Podium & Leaderboard Stage */}
            {leaderboardData.length > 0 && (() => {
              const goldGroup = leaderboardData.filter(item => item.rank === 1);
              const silverGroup = leaderboardData.filter(item => item.rank === 2);
              const bronzeGroup = leaderboardData.filter(item => item.rank === 3);

              return (
                <div className="space-y-6">
                  {/* Stepped Podium Section */}
                  <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 sm:p-8 space-y-8">
                    <div className="text-center space-y-1 border-b border-slate-100 pb-4">
                      <h3 className="text-xl font-black text-slate-800 flex items-center justify-center gap-2">
                        <Award className="w-6 h-6 text-amber-500" />
                        BỤC VINH DANH TOP 3
                      </h3>
                      <p className="text-xs text-slate-500">Tôn vinh những thí sinh xuất sắc nhất của đấu trường</p>
                    </div>

                    {/* Stepped Podium Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end max-w-4xl mx-auto pt-4 pb-2">

                      {/* 2. SILVER PODIUM (Left on desktop) */}
                      <div className="order-2 md:order-1 flex flex-col items-center">
                        {silverGroup.length > 0 ? (
                          <div className="w-full space-y-3 flex flex-col items-center mb-3">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
                              <Medal className="w-3.5 h-3.5 text-slate-500" />
                              HẠNG NHÌ (SILVER)
                            </div>
                            {silverGroup.map((p) => (
                              <div
                                key={p.participant_id}
                                className="w-full bg-gradient-to-b from-slate-50 to-white rounded-2xl border-2 border-slate-300 p-4 text-center shadow-md space-y-2"
                              >
                                <div className="relative inline-block mx-auto">
                                  {p.avatar_url ? (
                                    <img
                                      src={p.avatar_url}
                                      alt={p.display_name}
                                      className="w-14 h-14 rounded-full object-cover ring-4 ring-slate-300 shadow-md mx-auto"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-full bg-slate-300 text-slate-700 font-black text-lg flex items-center justify-center ring-4 ring-slate-200 shadow-md mx-auto">
                                      {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                                    </div>
                                  )}
                                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-slate-400 text-white font-black text-xs flex items-center justify-center shadow">
                                    2
                                  </span>
                                </div>
                                <div>
                                  <h4 className="font-extrabold text-sm text-slate-800 truncate" title={p.display_name}>
                                    {p.display_name}
                                  </h4>
                                  <span className="text-base font-black text-slate-700 block">
                                    {p.total_score ?? 0} <span className="text-xs font-normal text-slate-500">điểm</span>
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center justify-center gap-2 pt-1 border-t border-slate-100 font-medium">
                                  <span>Đúng {p.correct_count ?? 0} câu</span>
                                  <span>•</span>
                                  <span className="font-mono">{((p.total_response_time_ms ?? 0) / 1000).toFixed(1)}s</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="w-full text-center py-6 px-4 bg-slate-50/70 border border-dashed border-slate-200 rounded-2xl mb-3">
                            <span className="text-xs text-slate-400 font-medium italic">
                              {goldGroup.length > 1 ? 'Đồng hạng 1 (Không có Hạng Nhì)' : 'Chưa có dữ liệu'}
                            </span>
                          </div>
                        )}

                        {/* Stepped Base 2 */}
                        <div className="w-full h-32 sm:h-36 bg-gradient-to-t from-slate-400 to-slate-300 rounded-t-2xl shadow-md border-t-4 border-slate-200 flex flex-col items-center justify-center text-white">
                          <span className="text-4xl font-black font-mono tracking-wider drop-shadow-sm">2</span>
                          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-100 mt-1">HẠNG NHÌ</span>
                        </div>
                      </div>

                      {/* 1. GOLD PODIUM (Center - Highest) */}
                      <div className="order-1 md:order-2 flex flex-col items-center -mt-4">
                        {goldGroup.length > 0 ? (
                          <div className="w-full space-y-3 flex flex-col items-center mb-3">
                            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-gradient-to-r from-amber-400 to-amber-600 text-white shadow-md border border-amber-300 animate-pulse">
                              <Crown className="w-4 h-4 text-amber-200" />
                              QUÁN QUÂN (GOLD)
                            </div>
                            {goldGroup.map((p) => (
                              <div
                                key={p.participant_id}
                                className="w-full bg-gradient-to-b from-amber-50/80 to-white rounded-2xl border-2 border-amber-400 p-5 text-center shadow-lg space-y-2 ring-2 ring-amber-300/50"
                              >
                                <div className="relative inline-block mx-auto">
                                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-amber-500">
                                    <Crown className="w-6 h-6" />
                                  </div>
                                  {p.avatar_url ? (
                                    <img
                                      src={p.avatar_url}
                                      alt={p.display_name}
                                      className="w-16 h-16 rounded-full object-cover ring-4 ring-amber-400 shadow-lg mx-auto mt-2"
                                    />
                                  ) : (
                                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white font-black text-xl flex items-center justify-center ring-4 ring-amber-300 shadow-lg mx-auto mt-2">
                                      {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                                    </div>
                                  )}
                                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center shadow">
                                    1
                                  </span>
                                </div>
                                <div>
                                  <h4 className="font-black text-base text-slate-900 truncate" title={p.display_name}>
                                    {p.display_name}
                                  </h4>
                                  <span className="text-xl font-black text-amber-600 block">
                                    {p.total_score ?? 0} <span className="text-xs font-normal text-slate-500">điểm</span>
                                  </span>
                                </div>
                                <div className="text-xs text-slate-600 flex items-center justify-center gap-2 pt-1.5 border-t border-amber-100 font-semibold">
                                  <span>Đúng {p.correct_count ?? 0} câu</span>
                                  <span>•</span>
                                  <span className="font-mono">{((p.total_response_time_ms ?? 0) / 1000).toFixed(1)}s</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="w-full text-center py-6 px-4 bg-amber-50/50 border border-dashed border-amber-200 rounded-2xl mb-3">
                            <span className="text-xs text-amber-700 font-medium italic">Chưa có quán quân</span>
                          </div>
                        )}

                        {/* Stepped Base 1 */}
                        <div className="w-full h-44 sm:h-52 bg-gradient-to-t from-amber-500 to-amber-400 rounded-t-2xl shadow-xl border-t-4 border-amber-300 flex flex-col items-center justify-center text-white">
                          <span className="text-5xl font-black font-mono tracking-wider drop-shadow-md">1</span>
                          <span className="text-xs font-black uppercase tracking-widest text-amber-100 mt-1">QUÁN QUÂN</span>
                        </div>
                      </div>

                      {/* 3. BRONZE PODIUM (Right on desktop) */}
                      <div className="order-3 md:order-3 flex flex-col items-center">
                        {bronzeGroup.length > 0 ? (
                          <div className="w-full space-y-3 flex flex-col items-center mb-3">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                              <Medal className="w-3.5 h-3.5 text-amber-700" />
                              HẠNG BA (BRONZE)
                            </div>
                            {bronzeGroup.map((p) => (
                              <div
                                key={p.participant_id}
                                className="w-full bg-gradient-to-b from-amber-50/40 to-white rounded-2xl border-2 border-amber-700/40 p-4 text-center shadow-md space-y-2"
                              >
                                <div className="relative inline-block mx-auto">
                                  {p.avatar_url ? (
                                    <img
                                      src={p.avatar_url}
                                      alt={p.display_name}
                                      className="w-14 h-14 rounded-full object-cover ring-4 ring-amber-700/40 shadow-md mx-auto"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-full bg-amber-800 text-white font-black text-lg flex items-center justify-center ring-4 ring-amber-700/30 shadow-md mx-auto">
                                      {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                                    </div>
                                  )}
                                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-800 text-white font-black text-xs flex items-center justify-center shadow">
                                    3
                                  </span>
                                </div>
                                <div>
                                  <h4 className="font-extrabold text-sm text-slate-800 truncate" title={p.display_name}>
                                    {p.display_name}
                                  </h4>
                                  <span className="text-base font-black text-amber-900 block">
                                    {p.total_score ?? 0} <span className="text-xs font-normal text-slate-500">điểm</span>
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center justify-center gap-2 pt-1 border-t border-slate-100 font-medium">
                                  <span>Đúng {p.correct_count ?? 0} câu</span>
                                  <span>•</span>
                                  <span className="font-mono">{((p.total_response_time_ms ?? 0) / 1000).toFixed(1)}s</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="w-full text-center py-6 px-4 bg-slate-50/70 border border-dashed border-slate-200 rounded-2xl mb-3">
                            <span className="text-xs text-slate-400 font-medium italic">
                              {silverGroup.length > 1 ? 'Đồng hạng 2 (Không có Hạng Ba)' : 'Chưa có dữ liệu'}
                            </span>
                          </div>
                        )}

                        {/* Stepped Base 3 */}
                        <div className="w-full h-24 sm:h-28 bg-gradient-to-t from-amber-800 to-amber-700 rounded-t-2xl shadow-md border-t-4 border-amber-600 flex flex-col items-center justify-center text-white">
                          <span className="text-3xl font-black font-mono tracking-wider drop-shadow-sm">3</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-100 mt-1">HẠNG BA</span>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Full Leaderboard List Section */}
                  <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 sm:p-8 space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-sky-500" />
                          Bảng Xếp Hạng Toàn Bộ Thí Sinh ({leaderboardData.length})
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">Danh sách thứ hạng chính thức từ máy chủ được xếp theo Tổng Điểm, Số Câu Đúng và Thời Gian Phản Hồi</p>
                      </div>

                      <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-xl">
                        Thứ hạng máy chủ (Authoritative)
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/40">
                      {leaderboardData.map((item) => {
                        const isTop1 = item.rank === 1;
                        const isTop2 = item.rank === 2;
                        const isTop3 = item.rank === 3;

                        return (
                          <div
                            key={item.participant_id}
                            className={`p-4 flex items-center justify-between transition ${
                              isTop1
                                ? 'bg-amber-50/50 hover:bg-amber-50/80'
                                : isTop2
                                ? 'bg-slate-50/80 hover:bg-slate-100/80'
                                : isTop3
                                ? 'bg-amber-50/20 hover:bg-amber-50/40'
                                : 'bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3.5 min-w-0">
                              <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0 shadow-2xs ${
                                isTop1
                                  ? 'bg-amber-400 text-white ring-2 ring-amber-300'
                                  : isTop2
                                  ? 'bg-slate-300 text-slate-800 ring-2 ring-slate-200'
                                  : isTop3
                                  ? 'bg-amber-700 text-white ring-2 ring-amber-600'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                {isTop1 ? <Crown className="w-4 h-4" /> : isTop2 || isTop3 ? <Medal className="w-4 h-4" /> : item.rank}
                              </span>

                              <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-200">
                                {item.avatar_url ? (
                                  <img src={item.avatar_url} alt={item.display_name} className="w-full h-full object-cover" />
                                ) : (
                                  item.display_name?.charAt(0)?.toUpperCase() || 'H'
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-slate-800 truncate block">
                                    {item.display_name}
                                  </span>
                                  {isTop1 && (
                                    <span className="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 hidden sm:inline-block">
                                      Quán Quân
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                                  <span>Đúng {item.correct_count ?? 0} câu</span>
                                  <span>•</span>
                                  <span className="font-mono">{(item.total_response_time_ms ? (item.total_response_time_ms / 1000).toFixed(1) : '0.0')}s</span>
                                </span>
                              </div>
                            </div>

                            <div className="text-right flex-shrink-0 pl-3">
                              <span className="text-base font-black text-amber-600 block">
                                {item.total_score ?? 0} <span className="text-xs font-normal text-slate-500">điểm</span>
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Hạng {item.rank}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bottom Reset Action */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-xs text-slate-400">
                      Phiên thi đấu đã kết thúc hoàn toàn • CSDL đã hoàn tất lưu trữ
                    </div>
                    <button
                      type="button"
                      onClick={handleResetToSetup}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-sm shadow-md transition"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Tạo Đấu Trường Mới
                    </button>
                  </div>
                </div>
              );
            })()}
              </>
            )}

            {/* TAB 2: PHÂN TÍCH CÂU HỎI (HOST QUESTION ANALYTICS) */}
            {finishedTab === 'ANALYTICS' && (
              <HostQuestionAnalyticsView
                sessionId={activeSessionId}
                onBackToPodium={() => setFinishedTab('PODIUM')}
                onAnalyticsDataChange={setExportAnalyticsData}
              />
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* STATE F: CANCELLED SCREEN                                    */}
        {/* ============================================================ */}
        {currentStatus === 'cancelled' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto">
              <XCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Phòng Thi Đã Bị Hủy Bỏ</h2>
            <p className="text-xs text-slate-500">Phiên thi đấu này đã bị hủy bởi Giáo viên / Quản trị viên.</p>
            <div className="pt-4">
              <button
                type="button"
                onClick={handleResetToSetup}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs transition"
              >
                <RotateCcw className="w-4 h-4" />
                Quay Về Trang Tạo Phòng
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* LEADERBOARD DRAWER / PANEL (Quick Host Modal)                */}
        {/* ============================================================ */}
        {isLeaderboardOpen && hostViewMode !== 'LEADERBOARD' && activeSessionId && currentStatus !== 'finished' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Bảng Xếp Hạng Nhanh
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isLeaderboardLoading}
                  onClick={fetchLeaderboard}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 text-xs flex items-center gap-1 font-semibold"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLeaderboardLoading ? 'animate-spin' : ''}`} />
                  Làm mới
                </button>
                <button
                  type="button"
                  onClick={() => setIsLeaderboardOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            </div>

            {leaderboardData.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Chưa có kết quả điểm số nào được ghi nhận.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {leaderboardData.map((item) => (
                  <div key={item.participant_id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center">
                        {item.rank}
                      </span>
                      <div>
                        <span className="text-xs font-bold text-slate-800 block">{item.display_name}</span>
                        <span className="text-[10px] text-slate-400">Đúng {item.correct_count || 0} câu</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-extrabold text-amber-600 block">{item.total_score || 0} điểm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* CONFIRMATION MODAL                                           */}
        {/* ============================================================ */}
        {confirmModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
              <div className="flex items-center gap-3 text-red-600">
                <div className="p-2 bg-red-100 rounded-xl">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">{confirmModal.title}</h3>
              </div>

              <p className="text-sm text-slate-600">{confirmModal.message}</p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={actionPending}
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
                >
                  Hủy Thao Tác
                </button>
                <button
                  type="button"
                  disabled={actionPending}
                  onClick={confirmModal.onConfirm}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-50"
                >
                  {actionPending ? 'Đang thực hiện...' : 'Xác Nhận'}
                </button>
              </div>
            </div>
          </div>
        )}

        </div>
      </div>

      {/* R14 Question Source Modals */}
      <CompetitionQuestionBankModal
        isOpen={isQuestionBankModalOpen}
        onClose={() => setIsQuestionBankModalOpen(false)}
        onImportQuestions={handleImportFromBank}
        existingQuestions={questions}
        maxAllowed={MAX_COMPETITION_QUESTIONS}
      />

      <CompetitionImportExcelModal
        isOpen={isImportExcelModalOpen}
        onClose={() => setIsImportExcelModalOpen(false)}
        onImportQuestions={handleImportFromExcel}
        existingQuestions={questions}
        maxAllowed={MAX_COMPETITION_QUESTIONS}
      />

      {/* Print Layout (Hidden on Screen, Visible on Print) */}
      {currentStatus === 'finished' && snapshot && (
        <HostPrintableReport
          session={snapshot}
          leaderboardData={leaderboardData}
          analyticsData={exportAnalyticsData}
          isAnonymized={isAnonymizedExport}
          topN={exportTopN}
          printOrientation={printOrientation}
        />
      )}

    </div>
  );
}

export default CompetitionHostPage;


