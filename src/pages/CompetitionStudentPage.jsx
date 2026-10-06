import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Gamepad2,
  Sparkles,
  Trophy,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  ArrowRight,
  RefreshCw,
  LogOut,
  ShieldCheck,
  Check,
  Award,
  Crown,
  Medal,
  Flame,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  studentJoinSession,
  studentRejoinSession,
  studentSubmitAnswer,
  getLeaderboardSnapshot,
  getSessionSnapshot,
} from '../services/competitionClient.js';
import { useStudentCompetitionRealtime } from '../hooks/useStudentCompetitionRealtime.js';

// ============================================================================
// STORAGE KEYS & VALIDATION HELPERS (R4 PERSISTENCE CONTRACT)
// ============================================================================

export const STUDENT_SESSION_STORAGE_KEY = 'competition_student_session_id';
export const STUDENT_PARTICIPANT_STORAGE_KEY = 'competition_student_participant_id';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUUID = (value) => {
  if (!value || typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
};

// Safe initial session resolver (Query param -> sessionStorage -> null)
export const getInitialStudentSession = () => {
  try {
    if (typeof window === 'undefined') return { sessionId: null, participantId: null };
    const urlParams = new URLSearchParams(window.location.search);
    const urlSession = urlParams.get('sessionId') || urlParams.get('session_id');
    const validUrlSession = urlSession && isValidUUID(urlSession) ? urlSession.trim() : null;

    const storedSession = window.sessionStorage?.getItem(STUDENT_SESSION_STORAGE_KEY);
    const validStoredSession = storedSession && isValidUUID(storedSession) ? storedSession.trim() : null;

    const storedParticipant = window.sessionStorage?.getItem(STUDENT_PARTICIPANT_STORAGE_KEY);
    const validStoredParticipant = storedParticipant && isValidUUID(storedParticipant) ? storedParticipant.trim() : null;

    // Session resolution priority: valid URL session OR valid stored session
    const resolvedSessionId = validUrlSession || validStoredSession;
    const resolvedParticipantId = validStoredParticipant;

    if (storedSession && !validStoredSession) {
      window.sessionStorage?.removeItem(STUDENT_SESSION_STORAGE_KEY);
    }
    if (storedParticipant && !validStoredParticipant) {
      window.sessionStorage?.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
    }

    if (resolvedSessionId && resolvedParticipantId) {
      return { sessionId: resolvedSessionId, participantId: resolvedParticipantId };
    }
  } catch (_e) {
    // Fail safe
  }
  return { sessionId: null, participantId: null };
};

// Fail-closed vs Transient Network classification
export const isStudentAuthOrPermanentError = (errorCode, status) => {
  if (!errorCode && !status) return false;
  const code = String(errorCode).toUpperCase();

  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    code === 'PGRST116' ||
    code === '42501' ||
    code === 'FORBIDDEN_OR_NOT_FOUND' ||
    code === 'NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND' ||
    code === 'PARTICIPANT_NOT_FOUND' ||
    code === 'PARTICIPANT_KICKED' ||
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'ROLE_NOT_ALLOWED' ||
    code === 'SESSION_NOT_JOINABLE' ||
    code.includes('PERMISSION') ||
    code.includes('NOT_FOUND')
  ) {
    return true;
  }
  return false;
};

// ============================================================================
// MAIN COMPONENT: CompetitionStudentPage (R4 Student Final Results)
// ============================================================================

export const CompetitionStudentPage = () => {
  const { user, profile } = useAuth();

  // Session & Identity State
  const initialSession = useMemo(() => getInitialStudentSession(), []);
  const [sessionId, setSessionId] = useState(initialSession.sessionId);
  const [participantId, setParticipantId] = useState(initialSession.participantId);
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isRestoring, setIsRestoring] = useState(Boolean(initialSession.sessionId && initialSession.participantId));
  const [joinError, setJoinError] = useState(null);
  const [notification, setNotification] = useState(null);

  // Question & Submission Local State
  const [roomCode, setRoomCode] = useState('');
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmittedCurrentQuestion, setHasSubmittedCurrentQuestion] = useState(false);
  const [lastSubmittedQuestionId, setLastSubmittedQuestionId] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(null);

  // Guards & Independent Refs
  const activeSessionIdRef = useRef(sessionId);
  const activeParticipantIdRef = useRef(participantId);
  const restoredSessionPendingValidationRef = useRef(Boolean(initialSession.sessionId && initialSession.participantId));
  const isMountedRef = useRef(true);

  // Private Realtime Hook
  const {
    connectionStatus,
    sessionData,
    currentQuestion,
    leaderboard,
    error: realtimeError,
    refreshAuthoritativeState,
    refreshFinalLeaderboard,
  } = useStudentCompetitionRealtime({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
  });

  const [isRetryingLeaderboard, setIsRetryingLeaderboard] = useState(false);

  // Authoritative Status & Question Refs (Declared after hook destructuring to eliminate TDZ ReferenceError)
  const sessionStatusRef = useRef(sessionData?.status);
  const currentQuestionIdRef = useRef(currentQuestion?.id || null);

  // Authoritative Status & Question Sync Effects for Async Race Protection
  useEffect(() => {
    sessionStatusRef.current = sessionData?.status;
  }, [sessionData?.status]);

  useEffect(() => {
    currentQuestionIdRef.current = currentQuestion?.id || null;
  }, [currentQuestion?.id]);

  // Role Gate: Prevent teacher/admin from accidental student participation
  const isStudentRole = profile?.role === 'student';

  // Format error messages to concise Vietnamese
  const getFriendlyErrorMessage = (code, rawMessage) => {
    switch (code) {
      case 'INVALID_ROOM_CODE':
        return 'Mã phòng thi không được để trống.';
      case 'SESSION_NOT_FOUND':
        return 'Mã phòng thi không tồn tại hoặc đã bị đóng.';
      case 'SESSION_NOT_JOINABLE':
        return 'Phòng thi đã bắt đầu hoặc không mở tiếp nhận người mới.';
      case 'ROOM_FULL':
        return 'Phòng thi đã đủ số lượng người tham gia tối đa.';
      case 'ROLE_NOT_ALLOWED':
        return 'Chỉ tài khoản học sinh mới được phép tham gia đấu trường.';
      case 'TOO_MANY_JOIN_ATTEMPTS':
        return 'Quá nhiều lần thử thất bại. Vui lòng đợi 15 phút.';
      case 'ALREADY_ANSWERED':
        return 'Bạn đã nộp câu trả lời cho câu hỏi này rồi.';
      case 'SESSION_PAUSED':
        return 'Phòng thi đang tạm dừng.';
      case 'SESSION_CLOSED':
        return 'Phòng thi đã kết thúc.';
      case 'PARTICIPANT_KICKED':
        return 'Bạn đã bị mời ra khỏi phòng thi này.';
      case 'PARTICIPANT_NOT_FOUND':
        return 'Không tìm thấy thông tin thí sinh trong phòng thi.';
      default:
        return rawMessage || 'Đã xảy ra lỗi. Vui lòng thử lại.';
    }
  };

  // Auto show notification banner
  const showToast = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      if (isMountedRef.current) {
        setNotification(null);
      }
    }, 4000);
  }, []);

  // Fail-closed helper for invalid / unauthorized restored sessions
  const clearRestoredSessionAndReturnToJoin = useCallback((failureReason) => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem(STUDENT_SESSION_STORAGE_KEY);
        window.sessionStorage?.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
        if (window.location.search) {
          window.history?.replaceState({}, '', window.location.pathname);
        }
      }
    } catch (_e) {}

    activeSessionIdRef.current = null;
    activeParticipantIdRef.current = null;
    restoredSessionPendingValidationRef.current = false;
    setSessionId(null);
    setParticipantId(null);
    setParticipantInfo(null);
    setSelectedOptionId(null);
    setHasSubmittedCurrentQuestion(false);
    setLastSubmittedQuestionId(null);
    setSubmitResult(null);
    setSubmitError(null);
    setTimeLeftSeconds(null);
    setRoomCode('');
    setIsRestoring(false);

    if (failureReason) {
      setJoinError(failureReason);
      showToast(failureReason, 'error');
    }
  }, [showToast]);

  // Manual Retry Handler for Final Leaderboard on Transient Failures
  const handleRetryLeaderboard = useCallback(async () => {
    if (isRetryingLeaderboard) return;
    setIsRetryingLeaderboard(true);
    try {
      const res = await refreshFinalLeaderboard();
      if (!res.success) {
        if (isStudentAuthOrPermanentError(res.error_code, res.status)) {
          clearRestoredSessionAndReturnToJoin(getFriendlyErrorMessage(res.error_code, res.message));
        } else {
          showToast('Lỗi mạng khi tải bảng xếp hạng. Vui lòng thử lại.', 'warning');
        }
      } else {
        showToast('Đã tải thành công bảng xếp hạng!', 'success');
      }
    } finally {
      if (isMountedRef.current) {
        setIsRetryingLeaderboard(false);
      }
    }
  }, [refreshFinalLeaderboard, isRetryingLeaderboard, clearRestoredSessionAndReturnToJoin, showToast]);

  // Synchronize activeSessionIdRef & activeParticipantIdRef with sessionStorage persistence
  useEffect(() => {
    activeSessionIdRef.current = sessionId;
    activeParticipantIdRef.current = participantId;

    try {
      if (typeof window !== 'undefined') {
        if (sessionId && isValidUUID(sessionId)) {
          window.sessionStorage?.setItem(STUDENT_SESSION_STORAGE_KEY, sessionId);
        } else {
          window.sessionStorage?.removeItem(STUDENT_SESSION_STORAGE_KEY);
        }

        if (participantId && isValidUUID(participantId)) {
          window.sessionStorage?.setItem(STUDENT_PARTICIPANT_STORAGE_KEY, participantId);
        } else {
          window.sessionStorage?.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
        }
      }
    } catch (_e) {
      // Fail safe
    }
  }, [sessionId, participantId]);

  // Lifecycle Mount Guard
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Initial Restore & Authoritative Validation Effect (Authenticated Student)
  useEffect(() => {
    let isCancelled = false;

    async function validateAndRestoreSession() {
      const initial = getInitialStudentSession();
      if (!initial.sessionId || !initial.participantId) {
        setIsRestoring(false);
        return;
      }

      try {
        // 1. Fetch Session Snapshot
        const sessionRes = await getSessionSnapshot(initial.sessionId);
        if (isCancelled || !isMountedRef.current) return;

        if (!sessionRes.success) {
          if (isStudentAuthOrPermanentError(sessionRes.error_code, sessionRes.status)) {
            clearRestoredSessionAndReturnToJoin('Phiên thi không tồn tại hoặc bạn không có quyền truy cập.');
          } else {
            // Transient error: preserve session state for retry
            showToast('Đang kết nối lại phòng thi...', 'warning');
          }
          return;
        }

        const session = sessionRes.data;

        // 2. Cancelled session -> fail closed
        if (session.status === 'cancelled') {
          clearRestoredSessionAndReturnToJoin('Phòng thi đã bị hủy.');
          return;
        }

        // 3. Finished session -> DO NOT call rejoin RPC (avoids SESSION_CLOSED error); load leaderboard directly
        if (session.status === 'finished') {
          setSessionId(initial.sessionId);
          setParticipantId(initial.participantId);

          const lbRes = await getLeaderboardSnapshot({
            sessionId: initial.sessionId,
            participantId: initial.participantId,
          });

          if (isCancelled || !isMountedRef.current) return;

          if (!lbRes.success) {
            if (isStudentAuthOrPermanentError(lbRes.error_code, lbRes.status)) {
              clearRestoredSessionAndReturnToJoin('Bạn không có quyền xem kết quả phòng thi này.');
            } else {
              // Transient error: preserve session, allow retry via button
              showToast('Chưa tải được bảng xếp hạng chung cuộc. Bạn có thể nhấn nút thử lại.', 'warning');
            }
            restoredSessionPendingValidationRef.current = false;
            return;
          }

          const lbData = lbRes.data?.leaderboard || [];
          const matched = lbData.find((item) => item.participant_id === initial.participantId);
          if (lbData.length > 0 && !matched) {
            clearRestoredSessionAndReturnToJoin('Không tìm thấy thông tin thí sinh trong bảng kết quả phòng thi.');
            return;
          }

          if (matched) {
            setParticipantInfo({
              display_name: matched.display_name,
              avatar_url: matched.avatar_url,
            });
          }

          restoredSessionPendingValidationRef.current = false;
          return;
        }

        // 4. Active session (waiting / in_progress / paused) -> Call studentRejoinSession
        const rejoinRes = await studentRejoinSession({
          sessionId: initial.sessionId,
          participantId: initial.participantId,
          guestToken: null,
        });

        if (isCancelled || !isMountedRef.current) return;

        if (!rejoinRes.success) {
          if (isStudentAuthOrPermanentError(rejoinRes.error_code, rejoinRes.status)) {
            clearRestoredSessionAndReturnToJoin(getFriendlyErrorMessage(rejoinRes.error_code, rejoinRes.message));
          } else {
            showToast('Lỗi mạng khi kết nối lại. Vui lòng thử lại.', 'warning');
          }
          return;
        }

        const returnedPart = rejoinRes.data?.participant;
        if (!returnedPart || returnedPart.id !== initial.participantId) {
          clearRestoredSessionAndReturnToJoin('Thông tin thí sinh không khớp với phiên thi đã lưu.');
          return;
        }

        setSessionId(initial.sessionId);
        setParticipantId(initial.participantId);
        setParticipantInfo(returnedPart);
        restoredSessionPendingValidationRef.current = false;
      } catch (err) {
        // Transient error during restore: do not clear session
      } finally {
        if (!isCancelled && isMountedRef.current) {
          setIsRestoring(false);
        }
      }
    }

    validateAndRestoreSession();

    return () => {
      isCancelled = true;
    };
  }, [clearRestoredSessionAndReturnToJoin, showToast]);

  // Clean local question & submission state when session transitions to finished
  useEffect(() => {
    if (sessionData?.status === 'finished') {
      setSelectedOptionId(null);
      setHasSubmittedCurrentQuestion(false);
      setLastSubmittedQuestionId(null);
      setSubmitResult(null);
      setSubmitError(null);
      setTimeLeftSeconds(null);
    }
  }, [sessionData?.status]);

  // Reset answer selection when authoritative question ID changes
  useEffect(() => {
    if (currentQuestion?.id) {
      if (currentQuestion.id !== lastSubmittedQuestionId) {
        setSelectedOptionId(null);
        setHasSubmittedCurrentQuestion(false);
        setSubmitResult(null);
        setSubmitError(null);
      }
    }
  }, [currentQuestion?.id, lastSubmittedQuestionId]);

  // Countdown Timer based on server deadline (only while in_progress)
  useEffect(() => {
    if (!sessionData?.question_deadline || sessionData.status !== 'in_progress') {
      setTimeLeftSeconds(null);
      return;
    }

    const updateTimer = () => {
      const deadline = new Date(sessionData.question_deadline).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
      setTimeLeftSeconds(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [sessionData?.question_deadline, sessionData?.status]);

  // Handle Join Session
  const handleJoin = async (e) => {
    e?.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode || isJoining) return;

    setIsJoining(true);
    setJoinError(null);

    try {
      const res = await studentJoinSession({
        roomCode: cleanCode,
        displayName: profile?.full_name || 'Học sinh',
        avatarUrl: profile?.avatar_url || null,
        guestToken: null, // Authenticated student uses no guest token
      });

      if (!res.success) {
        setJoinError(getFriendlyErrorMessage(res.error_code, res.message));
        return;
      }

      const sess = res.data?.session;
      const part = res.data?.participant;

      const newSessionId = sess?.id || res.data?.session_id;
      const newParticipantId = part?.id || res.data?.participant_id;

      if (!newSessionId || !newParticipantId) {
        setJoinError('Phản hồi từ máy chủ thiếu thông tin phòng thi.');
        return;
      }

      setSessionId(newSessionId);
      setParticipantId(newParticipantId);
      setParticipantInfo(part || { display_name: profile?.full_name || 'Học sinh' });
    } catch (err) {
      setJoinError(err.message || 'Không thể kết nối đến máy chủ.');
    } finally {
      if (isMountedRef.current) {
        setIsJoining(false);
      }
    }
  };

  // Handle Submit Answer with Stale, Question Advance, & Terminal Guards
  const handleSubmitAnswer = async () => {
    if (
      !selectedOptionId ||
      isSubmitting ||
      hasSubmittedCurrentQuestion ||
      !currentQuestion?.id ||
      sessionData?.status !== 'in_progress'
    ) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    const targetSessionId = activeSessionIdRef.current;
    const targetParticipantId = activeParticipantIdRef.current;
    const targetQuestionId = currentQuestion.id;

    try {
      const res = await studentSubmitAnswer({
        sessionId: targetSessionId,
        questionId: targetQuestionId,
        participantId: targetParticipantId,
        guestToken: null,
        selectedOptionIds: [selectedOptionId],
      });

      // Strict Authoritative Invariants Guard:
      // Response is ONLY valid and committed if:
      // 1. Component is mounted
      // 2. Active session is STILL targetSessionId
      // 3. Active participant is STILL targetParticipantId
      // 4. Current question is STILL targetQuestionId
      // 5. Session status is STILL in_progress
      const isResponseValid =
        isMountedRef.current === true &&
        activeSessionIdRef.current === targetSessionId &&
        activeParticipantIdRef.current === targetParticipantId &&
        currentQuestionIdRef.current === targetQuestionId &&
        sessionStatusRef.current === 'in_progress';

      if (!isResponseValid) {
        return;
      }

      if (!res.success) {
        if (res.error_code === 'SESSION_NOT_ACTIVE' || res.error_code === 'SESSION_CLOSED') {
          return;
        }
        if (res.error_code === 'ALREADY_ANSWERED') {
          setHasSubmittedCurrentQuestion(true);
          setLastSubmittedQuestionId(targetQuestionId);
        } else {
          setSubmitError(getFriendlyErrorMessage(res.error_code, res.message));
        }
        return;
      }

      setHasSubmittedCurrentQuestion(true);
      setLastSubmittedQuestionId(targetQuestionId);
      setSubmitResult(res.data);
      refreshAuthoritativeState();
    } catch (err) {
      if (
        isMountedRef.current === true &&
        activeSessionIdRef.current === targetSessionId &&
        activeParticipantIdRef.current === targetParticipantId &&
        currentQuestionIdRef.current === targetQuestionId &&
        sessionStatusRef.current === 'in_progress'
      ) {
        setSubmitError(err.message || 'Lỗi khi gửi câu trả lời.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  // Handle Clean Exit (Clears Storage and resets state)
  const handleExit = () => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem(STUDENT_SESSION_STORAGE_KEY);
        window.sessionStorage?.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
        if (window.location.search) {
          window.history?.replaceState({}, '', window.location.pathname);
        }
      }
    } catch (_e) {}

    activeSessionIdRef.current = null;
    activeParticipantIdRef.current = null;
    restoredSessionPendingValidationRef.current = false;
    setSessionId(null);
    setParticipantId(null);
    setParticipantInfo(null);
    setSelectedOptionId(null);
    setHasSubmittedCurrentQuestion(false);
    setLastSubmittedQuestionId(null);
    setSubmitResult(null);
    setSubmitError(null);
    setTimeLeftSeconds(null);
    setRoomCode('');
    setJoinError(null);
  };

  // Option Letter Helpers
  const getOptionLetter = (index) => {
    return String.fromCharCode(65 + index); // 0 -> A, 1 -> B, 2 -> C, 3 -> D
  };

  // Find current student's score in authoritative leaderboard
  const studentLeaderboardEntry = useMemo(() => {
    if (!leaderboard || !participantId) return null;
    return leaderboard.find((item) => item.participant_id === participantId) || null;
  }, [leaderboard, participantId]);

  // Mini Podium Groups (Grouped strictly by backend authoritative rank)
  const goldWinners = useMemo(() => {
    return Array.isArray(leaderboard) ? leaderboard.filter((item) => item.rank === 1) : [];
  }, [leaderboard]);

  const silverWinners = useMemo(() => {
    return Array.isArray(leaderboard) ? leaderboard.filter((item) => item.rank === 2) : [];
  }, [leaderboard]);

  const bronzeWinners = useMemo(() => {
    return Array.isArray(leaderboard) ? leaderboard.filter((item) => item.rank === 3) : [];
  }, [leaderboard]);

  // ==========================================================================
  // VIEW RENDERERS
  // ==========================================================================

  // 1. NON-STUDENT ROLE NOTICE
  if (profile && !isStudentRole) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-amber-50 border-4 border-amber-300 rounded-3xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-amber-400">
            <AlertCircle className="w-8 h-8 text-amber-700" />
          </div>
          <h2 className="text-2xl font-black text-amber-950 mb-3">
            Khu Vực Dành Riêng Cho Học Sinh
          </h2>
          <p className="text-base text-amber-900 font-medium mb-6 leading-relaxed">
            Tài khoản hiện tại của bạn có vai trò <span className="font-bold underline">{profile.role === 'teacher' ? 'Giáo viên' : 'Quản trị viên'}</span>.
            Để tham gia thi đấu với tư cách thí sinh, vui lòng đăng nhập bằng tài khoản Học sinh.
          </p>
          <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-200/80 rounded-xl text-amber-900 font-bold text-sm">
            <ShieldCheck className="w-4 h-4" /> Giáo viên vui lòng sử dụng trang Quản Trị Đấu Trường (Host) để tạo và điều hành phòng thi.
          </div>
        </div>
      </div>
    );
  }

  // 2. RESTORING LOADING STATE
  if (isRestoring && !sessionData) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-sky-100 rounded-3xl flex items-center justify-center mx-auto mb-4 border-2 border-sky-300">
          <RefreshCw className="w-8 h-8 text-sky-600 animate-spin" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">Đang khôi phục phiên thi đấu...</h2>
        <p className="text-sm font-semibold text-slate-500">Vui lòng chờ trong giây lát.</p>
      </div>
    );
  }

  // 3. JOIN VIEW (State A & B: When no active session)
  if (!sessionId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Toast Notification Banner */}
        {notification && (
          <div
            className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-lg border-2 font-bold text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-4 ${
              notification.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-300'
                : notification.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : 'bg-emerald-50 text-emerald-800 border-emerald-300'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{notification.message}</span>
          </div>
        )}

        <div className="bg-white rounded-3xl border-4 border-sky-200 shadow-md p-6 sm:p-8 text-center">
          {/* Header Icon */}
          <div className="w-20 h-20 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm shadow-sky-200 border-2 border-white">
            <Gamepad2 className="w-10 h-10 text-white" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-slate-800 mb-2 flex items-center justify-center gap-2">
            Đấu Trường Trực Tuyến <Sparkles className="w-6 h-6 text-amber-500 fill-amber-400" />
          </h1>
          <p className="text-slate-600 font-medium mb-8 text-sm sm:text-base">
            Nhập mã phòng do giáo viên cung cấp để tham gia tranh tài cùng các bạn!
          </p>

          {/* Student Profile Identity Card */}
          <div className="bg-sky-50 border-2 border-sky-200 rounded-2xl p-4 mb-6 flex items-center gap-4 text-left">
            <div className="w-12 h-12 rounded-full bg-sky-200 border-2 border-sky-400 flex items-center justify-center font-black text-sky-800 text-lg overflow-hidden shrink-0">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'HS'
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-sky-600 uppercase tracking-wider">Học sinh tham gia</div>
              <div className="text-base font-black text-slate-800 truncate">
                {profile?.full_name || 'Học sinh'}
              </div>
            </div>
          </div>

          {/* Error Banner */}
          {joinError && (
            <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 mb-6 text-left flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-sm font-bold text-rose-800">{joinError}</div>
            </div>
          )}

          {/* Join Form */}
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="room-code-input" className="block text-left text-sm font-black text-slate-700 mb-2">
                Mã Phòng Thi
              </label>
              <input
                id="room-code-input"
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="VD: ABC123XYZ"
                maxLength={20}
                disabled={isJoining}
                className="w-full px-5 py-4 text-center text-2xl font-black tracking-widest uppercase bg-slate-50 border-3 border-slate-300 rounded-2xl focus:bg-white focus:border-sky-500 focus:outline-none transition-all placeholder:text-slate-300 placeholder:normal-case placeholder:text-base placeholder:tracking-normal"
              />
            </div>

            <button
              type="submit"
              disabled={isJoining || !roomCode.trim()}
              className="w-full py-4 px-6 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-black text-lg rounded-2xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 active:scale-[0.99]"
            >
              {isJoining ? (
                <>
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <span>Đang vào phòng thi...</span>
                </>
              ) : (
                <>
                  <span>Vào Đấu Trường</span>
                  <ArrowRight className="w-6 h-6" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 4. LOBBY VIEW (State C: Session Waiting)
  if (sessionData?.status === 'waiting') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl border-4 border-sky-200 shadow-md p-6 sm:p-8 text-center">
          {/* Top Status Bar */}
          <div className="flex items-center justify-between pb-6 mb-6 border-b-2 border-slate-100">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-black text-emerald-700 uppercase tracking-wider">
                {connectionStatus === 'connected' ? 'Đã kết nối' : 'Đang đồng bộ...'}
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-sky-100 rounded-full text-sky-800 text-xs font-black">
              Phòng: {sessionData.room_code}
            </div>
          </div>

          {/* Session Info */}
          <h1 className="text-2xl sm:text-3xl font-black text-slate-800 mb-2">
            {sessionData.title || 'Đấu Trường Trực Tuyến'}
          </h1>
          {sessionData.description && (
            <p className="text-slate-600 font-medium mb-6 text-sm">
              {sessionData.description}
            </p>
          )}

          {/* Waiting Animation Card */}
          <div className="bg-gradient-to-br from-sky-50 to-indigo-50 border-3 border-sky-200 rounded-3xl p-8 my-8 text-center">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border-2 border-sky-300 animate-bounce">
              <Clock className="w-10 h-10 text-sky-600" />
            </div>
            <h2 className="text-xl font-black text-sky-950 mb-2">
              Đang chờ giáo viên bắt đầu...
            </h2>
            <p className="text-sm font-semibold text-slate-600 max-w-md mx-auto">
              Hãy chuẩn bị tinh thần sẵn sàng! Câu hỏi sẽ tự động xuất hiện ngay khi giáo viên khởi động vòng thi.
            </p>
          </div>

          {/* Student Identity Footer */}
          <div className="flex items-center justify-between pt-4 border-t-2 border-slate-100">
            <div className="flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-full bg-sky-100 border-2 border-sky-300 flex items-center justify-center font-bold text-sky-700 text-sm overflow-hidden">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'HS'
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500 font-bold">Thí sinh</div>
                <div className="text-sm font-black text-slate-800">{participantInfo?.display_name || profile?.full_name}</div>
              </div>
            </div>

            <button
              onClick={handleExit}
              className="px-4 py-2 border-2 border-slate-200 hover:border-slate-300 rounded-xl text-slate-600 hover:text-slate-800 font-bold text-xs flex items-center gap-2 transition-all"
            >
              <LogOut className="w-4 h-4" /> Rời phòng
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 5. PAUSED STATE BANNER
  const isPaused = sessionData?.status === 'paused';

  // 6. FINISHED STATE: STUDENT FINAL RESULTS & MINI PODIUM (State G)
  if (sessionData?.status === 'finished') {
    // Motivational Message for Student Personal Achievement
    const getMotivationalBadge = (rank) => {
      if (rank === 1) {
        return {
          title: 'Quán Quân Xuất Sắc! 👑',
          desc: 'Chúc mừng bạn đã giành ngôi vị cao nhất trên Đấu Trường hôm nay!',
          badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
        };
      }
      if (rank === 2 || rank === 3) {
        return {
          title: 'Lọt Vào Bục Vinh Danh! 🌟',
          desc: 'Thành tích vượt trội! Bạn đã đứng trên bục vinh danh của cuộc thi!',
          badgeClass: 'bg-sky-100 text-sky-900 border-sky-300',
        };
      }
      if (rank && rank <= 5) {
        return {
          title: 'Top 5 Thí Sinh Dẫn Đầu! ⚡',
          desc: 'Màn thể hiện rất ấn tượng! Hãy tiếp tục duy trì phong độ nhé!',
          badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-300',
        };
      }
      return {
        title: 'Hoàn Thành Xuất Sắc! 👏',
        desc: 'Bạn đã nỗ lực hết mình và hoàn thành trọn vẹn vòng thi đấu!',
        badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
      };
    };

    const motivational = getMotivationalBadge(studentLeaderboardEntry?.rank);

    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl border-4 border-amber-300 shadow-xl p-6 sm:p-10 text-center">
          {/* Header Trophy Banner */}
          <div className="w-24 h-24 bg-gradient-to-tr from-amber-400 via-amber-300 to-yellow-400 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-md border-3 border-white">
            <Trophy className="w-12 h-12 text-amber-900 drop-shadow-sm" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-slate-800 mb-2">
            Đấu Trường Đã Hoàn Thành! 🏆
          </h1>
          <p className="text-slate-600 font-semibold mb-8 text-base">
            Chúc mừng tất cả các bạn học sinh đã tham gia và nỗ lực hết mình!
          </p>

          {/* Personal Achievement Highlight Card */}
          {studentLeaderboardEntry ? (
            <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/50 border-3 border-amber-300 rounded-3xl p-6 mb-10 text-left shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b-2 border-amber-200/70">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-amber-200 border-2 border-amber-400 flex items-center justify-center font-black text-amber-900 text-lg overflow-hidden shrink-0">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'HS'
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-amber-700 uppercase tracking-wider">Thành tích của bạn</div>
                    <div className="text-lg font-black text-amber-950 truncate">{profile?.full_name || 'Học sinh'}</div>
                  </div>
                </div>

                <div className={`px-4 py-1.5 rounded-xl border-2 font-black text-xs ${motivational.badgeClass}`}>
                  {motivational.title}
                </div>
              </div>

              {/* Personal Metric Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="bg-white/90 rounded-2xl p-3 border-2 border-amber-200">
                  <div className="text-xs font-bold text-slate-500 mb-1">Thứ hạng</div>
                  <div className="text-2xl sm:text-3xl font-black text-amber-700 flex items-center justify-center gap-1">
                    #{studentLeaderboardEntry.rank ?? '—'}
                  </div>
                </div>

                <div className="bg-white/90 rounded-2xl p-3 border-2 border-amber-200">
                  <div className="text-xs font-bold text-slate-500 mb-1">Tổng điểm</div>
                  <div className="text-2xl sm:text-3xl font-black text-emerald-600">
                    {studentLeaderboardEntry.total_score ?? 0} <span className="text-xs font-bold text-slate-400">đ</span>
                  </div>
                </div>

                <div className="bg-white/90 rounded-2xl p-3 border-2 border-amber-200">
                  <div className="text-xs font-bold text-slate-500 mb-1">Số câu đúng</div>
                  <div className="text-2xl sm:text-3xl font-black text-sky-600">
                    {studentLeaderboardEntry.correct_count ?? 0} <span className="text-xs font-bold text-slate-400">câu</span>
                  </div>
                </div>

                <div className="bg-white/90 rounded-2xl p-3 border-2 border-amber-200">
                  <div className="text-xs font-bold text-slate-500 mb-1">Thời gian</div>
                  <div className="text-2xl sm:text-3xl font-black text-indigo-600">
                    {Math.round((studentLeaderboardEntry.total_response_time_ms || 0) / 1000)} <span className="text-xs font-bold text-slate-400">s</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4 mb-8 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-600">
                Đang tải kết quả cá nhân của bạn...
              </span>
              <button
                type="button"
                onClick={handleRetryLeaderboard}
                disabled={isRetryingLeaderboard}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs rounded-xl transition-all shadow-sm active:scale-95 inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingLeaderboard ? 'animate-spin' : ''}`} />
                <span>{isRetryingLeaderboard ? 'Đang tải...' : 'Thử tải lại'}</span>
              </button>
            </div>
          )}

          {/* Mini Podium (Top 3 Authoritative Grouping with Tie-Rank Support) */}
          <div className="mb-10">
            <h2 className="text-xl font-black text-slate-800 mb-6 flex items-center justify-center gap-2">
              <Award className="w-6 h-6 text-amber-500" /> Bục Vinh Danh Đấu Trường
            </h2>

            <div className="grid grid-cols-3 gap-3 sm:gap-6 items-end max-w-2xl mx-auto pt-4 pb-2">
              {/* Silver Step (Rank 2 - Left) */}
              <div className="flex flex-col items-center">
                <div className="mb-2 text-center min-h-[60px] flex flex-col items-center justify-end">
                  {silverWinners.length > 0 ? (
                    silverWinners.map((winner) => (
                      <div key={winner.participant_id} className="mb-1">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-200 border-2 border-slate-400 flex items-center justify-center font-bold text-slate-700 text-sm overflow-hidden mx-auto shadow-sm">
                          {winner.avatar_url ? (
                            <img src={winner.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            winner.display_name?.charAt(0).toUpperCase() || 'H'
                          )}
                        </div>
                        <div className="text-xs font-black text-slate-800 truncate max-w-[90px] sm:max-w-[120px] mt-1">
                          {winner.display_name}
                        </div>
                        <div className="text-xs font-bold text-slate-500">{winner.total_score}đ</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs font-bold text-slate-400 italic">Trống</div>
                  )}
                </div>

                <div className="w-full bg-gradient-to-t from-slate-300 to-slate-200 border-3 border-slate-300 rounded-t-2xl h-24 sm:h-28 flex flex-col items-center justify-center shadow-md">
                  <Medal className="w-7 h-7 text-slate-500 mb-1" />
                  <span className="text-sm sm:text-base font-black text-slate-700">Hạng 2</span>
                </div>
              </div>

              {/* Gold Step (Rank 1 - Center - Tallest) */}
              <div className="flex flex-col items-center">
                <div className="mb-2 text-center min-h-[60px] flex flex-col items-center justify-end">
                  {goldWinners.length > 0 ? (
                    goldWinners.map((winner) => (
                      <div key={winner.participant_id} className="mb-1">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-amber-100 border-3 border-amber-400 flex items-center justify-center font-black text-amber-800 text-base overflow-hidden mx-auto shadow-md ring-2 ring-amber-300">
                          {winner.avatar_url ? (
                            <img src={winner.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            winner.display_name?.charAt(0).toUpperCase() || 'H'
                          )}
                        </div>
                        <div className="text-xs sm:text-sm font-black text-amber-950 truncate max-w-[100px] sm:max-w-[140px] mt-1">
                          {winner.display_name}
                        </div>
                        <div className="text-xs font-black text-amber-700">{winner.total_score}đ</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs font-bold text-slate-400 italic">Trống</div>
                  )}
                </div>

                <div className="w-full bg-gradient-to-t from-amber-400 to-yellow-300 border-3 border-amber-300 rounded-t-2xl h-32 sm:h-36 flex flex-col items-center justify-center shadow-lg">
                  <Crown className="w-9 h-9 text-amber-900 fill-amber-500 mb-1" />
                  <span className="text-base sm:text-lg font-black text-amber-950">Quán Quân</span>
                </div>
              </div>

              {/* Bronze Step (Rank 3 - Right) */}
              <div className="flex flex-col items-center">
                <div className="mb-2 text-center min-h-[60px] flex flex-col items-center justify-end">
                  {bronzeWinners.length > 0 ? (
                    bronzeWinners.map((winner) => (
                      <div key={winner.participant_id} className="mb-1">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-amber-200/80 border-2 border-amber-600/60 flex items-center justify-center font-bold text-amber-900 text-sm overflow-hidden mx-auto shadow-sm">
                          {winner.avatar_url ? (
                            <img src={winner.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            winner.display_name?.charAt(0).toUpperCase() || 'H'
                          )}
                        </div>
                        <div className="text-xs font-black text-slate-800 truncate max-w-[90px] sm:max-w-[120px] mt-1">
                          {winner.display_name}
                        </div>
                        <div className="text-xs font-bold text-amber-800">{winner.total_score}đ</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs font-bold text-slate-400 italic">Trống</div>
                  )}
                </div>

                <div className="w-full bg-gradient-to-t from-amber-700/80 to-amber-600/70 border-3 border-amber-700/50 rounded-t-2xl h-20 sm:h-24 flex flex-col items-center justify-center shadow-md">
                  <Medal className="w-6 h-6 text-amber-100 mb-1" />
                  <span className="text-sm sm:text-base font-black text-white">Hạng 3</span>
                </div>
              </div>
            </div>
          </div>

          {/* Full Leaderboard Table */}
          <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl overflow-hidden mb-8 text-left">
            <div className="px-5 py-3.5 bg-slate-100 border-b-2 border-slate-200 flex items-center justify-between text-xs font-black text-slate-600 uppercase tracking-wider">
              <div className="w-16">Hạng</div>
              <div className="flex-1">Thí sinh</div>
              <div className="w-24 text-center hidden sm:block">Số câu đúng</div>
              <div className="w-24 text-right">Tổng điểm</div>
            </div>

            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {!Array.isArray(leaderboard) || leaderboard.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="text-sm font-bold text-slate-500 mb-3">
                    {realtimeError || 'Chưa tải được bảng xếp hạng chung cuộc hoặc đang tải...'}
                  </div>
                  <button
                    type="button"
                    onClick={handleRetryLeaderboard}
                    disabled={isRetryingLeaderboard}
                    className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm rounded-xl transition-all shadow-sm active:scale-95 inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRetryingLeaderboard ? 'animate-spin' : ''}`} />
                    <span>{isRetryingLeaderboard ? 'Đang tải...' : 'Thử tải lại kết quả'}</span>
                  </button>
                </div>
              ) : (
                leaderboard.map((item, idx) => {
                  const isCurrentStudent = item.participant_id === participantId;
                  const rankDisplay = item.rank !== null && item.rank !== undefined ? `#${item.rank}` : '—';

                  return (
                    <div
                      key={item.participant_id || idx}
                      className={`px-5 py-3.5 flex items-center justify-between transition-colors ${
                        isCurrentStudent ? 'bg-amber-100/80 font-black' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="w-16 flex items-center gap-1.5 font-black text-sm text-slate-700">
                        {item.rank === 1 && <Crown className="w-4 h-4 text-amber-500 fill-amber-400 shrink-0" />}
                        {item.rank === 2 && <Medal className="w-4 h-4 text-slate-400 shrink-0" />}
                        {item.rank === 3 && <Medal className="w-4 h-4 text-amber-700 shrink-0" />}
                        <span>{rankDisplay}</span>
                      </div>

                      <div className="flex-1 flex items-center gap-3 min-w-0 pr-4">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 shrink-0 overflow-hidden">
                          {item.avatar_url ? (
                            <img src={item.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            item.display_name?.charAt(0).toUpperCase() || 'H'
                          )}
                        </div>
                        <span className="truncate text-sm font-bold text-slate-800">
                          {item.display_name} {isCurrentStudent && <span className="text-xs text-amber-800 font-black ml-1">(Bạn)</span>}
                        </span>
                      </div>

                      <div className="w-24 text-center text-sm font-bold text-slate-600 hidden sm:block">
                        {item.correct_count ?? 0}
                      </div>

                      <div className="w-24 text-right text-sm font-black text-emerald-600">
                        {item.total_score ?? 0} đ
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Action Exit Button */}
          <button
            onClick={handleExit}
            className="px-8 py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-black text-base rounded-2xl transition-all shadow-md active:scale-95 inline-flex items-center gap-2"
          >
            <LogOut className="w-5 h-5" />
            <span>Quay Về Trang Chủ</span>
          </button>
        </div>
      </div>
    );
  }

  // 7. CANCELLED STATE (State H)
  if (sessionData?.status === 'cancelled') {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl border-4 border-rose-200 shadow-md p-8 text-center">
          <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-rose-300">
            <AlertCircle className="w-8 h-8 text-rose-600" />
          </div>
          <h1 className="text-2xl font-black text-rose-950 mb-2">
            Phòng Thi Đã Bị Hủy
          </h1>
          <p className="text-slate-600 font-medium mb-6 text-sm">
            Giáo viên đã hủy phiên đấu trường này. Vui lòng liên hệ giáo viên để biết thêm chi tiết.
          </p>
          <button
            onClick={handleExit}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm rounded-xl transition-all"
          >
            Thoát Ra Ngoài
          </button>
        </div>
      </div>
    );
  }

  // 8. ACTIVE QUESTION & SUBMITTED STATE (State D, E, F)
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      {/* Paused Banner */}
      {isPaused && (
        <div className="bg-amber-500 text-white px-6 py-3.5 rounded-2xl mb-6 shadow-sm flex items-center justify-between font-black text-sm animate-pulse">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            <span>Tạm dừng — chờ giáo viên tiếp tục</span>
          </div>
          <span className="text-xs bg-amber-600/60 px-3 py-1 rounded-full uppercase">Tạm ngưng</span>
        </div>
      )}

      {/* Main Arena Card */}
      <div className="bg-white rounded-3xl border-4 border-sky-200 shadow-md overflow-hidden">
        {/* Arena Top Status Header */}
        <div className="px-6 py-4 bg-slate-50 border-b-2 border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="px-3.5 py-1.5 bg-sky-500 text-white font-black text-xs sm:text-sm rounded-xl shadow-sm">
              Câu {currentQuestion?.question_order || sessionData?.current_question_index || 1}
            </span>
            <span className="text-xs sm:text-sm font-bold text-slate-500 truncate max-w-[150px] sm:max-w-xs">
              {sessionData?.title || 'Đấu Trường'}
            </span>
          </div>

          {/* Countdown Clock */}
          {timeLeftSeconds !== null && (
            <div
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl font-black text-sm sm:text-base border-2 ${
                timeLeftSeconds <= 5
                  ? 'bg-rose-50 text-rose-600 border-rose-300 animate-bounce'
                  : timeLeftSeconds <= 10
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-sky-50 text-sky-700 border-sky-300'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{timeLeftSeconds}s</span>
            </div>
          )}
        </div>

        {/* Question & Options Content */}
        <div className="p-6 sm:p-8">
          {currentQuestion ? (
            <>
              {/* Question Text */}
              <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-8 leading-snug">
                {currentQuestion.question_text}
              </h2>

              {/* Options Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                {Array.isArray(currentQuestion.options) &&
                  currentQuestion.options.map((option, idx) => {
                    const isSelected = selectedOptionId === option.id;
                    const letter = getOptionLetter(idx);
                    const disabled = isSubmitting || hasSubmittedCurrentQuestion || isPaused;

                    return (
                      <button
                        key={option.id || idx}
                        type="button"
                        onClick={() => !disabled && setSelectedOptionId(option.id)}
                        disabled={disabled}
                        className={`p-4 sm:p-5 rounded-2xl border-3 text-left transition-all flex items-start gap-4 active:scale-[0.99] ${
                          isSelected
                            ? 'bg-sky-50 border-sky-500 ring-2 ring-sky-300 shadow-md'
                            : 'bg-white border-slate-200 hover:border-sky-300 hover:bg-slate-50/50'
                        } ${disabled && !isSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-base shrink-0 border-2 ${
                            isSelected
                              ? 'bg-sky-500 text-white border-sky-600'
                              : 'bg-slate-100 text-slate-700 border-slate-300'
                          }`}
                        >
                          {letter}
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <div className="text-base font-bold text-slate-800">
                            {option.text || option.content || option.label || 'Lựa chọn'}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0 mt-1.5">
                            <Check className="w-4 h-4 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
              </div>

              {/* Submit Error */}
              {submitError && (
                <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 mb-6 text-left flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-sm font-bold text-rose-800">{submitError}</div>
                </div>
              )}

              {/* Submission Controls & Status */}
              {hasSubmittedCurrentQuestion ? (
                /* State E: ANSWER_SUBMITTED */
                <div className="bg-emerald-50 border-3 border-emerald-300 rounded-2xl p-6 text-center">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 border-2 border-emerald-400">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-black text-emerald-950 mb-1">
                    Đã Nộp Câu Trả Lời Thành Công! 🎉
                  </h3>
                  {submitResult?.points_awarded !== undefined && (
                    <p className="text-sm font-bold text-emerald-800 mb-2">
                      {submitResult.is_correct ? 'Chính xác! 🌟' : 'Đã ghi nhận! ⚡'} (+{submitResult.points_awarded} điểm)
                    </p>
                  )}
                  <p className="text-xs font-semibold text-slate-600">
                    Vui lòng chờ giáo viên chuyển sang câu hỏi tiếp theo...
                  </p>
                </div>
              ) : (
                /* State D: ACTIVE_QUESTION (Waiting for Student Submission) */
                <button
                  type="button"
                  onClick={handleSubmitAnswer}
                  disabled={!selectedOptionId || isSubmitting || isPaused}
                  className="w-full py-4 px-6 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-lg rounded-2xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 active:scale-[0.99]"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      <span>Đang nộp câu trả lời...</span>
                    </>
                  ) : (
                    <>
                      <span>Nộp Câu Trả Lời</span>
                      <ArrowRight className="w-6 h-6" />
                    </>
                  )}
                </button>
              )}
            </>
          ) : (
            /* Loading Question Snapshot */
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-sky-500 animate-spin mx-auto mb-3" />
              <div className="text-sm font-bold text-slate-600">Đang tải câu hỏi...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
