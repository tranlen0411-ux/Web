import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  HelpCircle,
  Award,
  Crown,
  Medal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  studentJoinSession,
  studentSubmitAnswer,
  getLeaderboardSnapshot,
} from '../services/competitionClient.js';
import { useStudentCompetitionRealtime } from '../hooks/useStudentCompetitionRealtime.js';

export const CompetitionStudentPage = () => {
  const { user, profile } = useAuth();

  // Component Local State
  const [roomCode, setRoomCode] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [participantId, setParticipantId] = useState(null);
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  // Question & Submission Local State
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmittedCurrentQuestion, setHasSubmittedCurrentQuestion] = useState(false);
  const [lastSubmittedQuestionId, setLastSubmittedQuestionId] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(null);

  // Private Realtime Hook
  const {
    connectionStatus,
    sessionData,
    currentQuestion,
    leaderboard,
    error: realtimeError,
    refreshAuthoritativeState,
  } = useStudentCompetitionRealtime({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
  });

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
      default:
        return rawMessage || 'Đã xảy ra lỗi. Vui lòng thử lại.';
    }
  };

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

  // Countdown Timer based on server deadline
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
      setIsJoining(false);
    }
  };

  // Handle Submit Answer
  const handleSubmitAnswer = async () => {
    if (!selectedOptionId || isSubmitting || hasSubmittedCurrentQuestion || !currentQuestion?.id) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await studentSubmitAnswer({
        sessionId,
        questionId: currentQuestion.id,
        participantId,
        guestToken: null,
        selectedOptionIds: [selectedOptionId],
      });

      if (!res.success) {
        if (res.error_code === 'ALREADY_ANSWERED') {
          setHasSubmittedCurrentQuestion(true);
          setLastSubmittedQuestionId(currentQuestion.id);
        } else {
          setSubmitError(getFriendlyErrorMessage(res.error_code, res.message));
        }
        return;
      }

      setHasSubmittedCurrentQuestion(true);
      setLastSubmittedQuestionId(currentQuestion.id);
      setSubmitResult(res.data);
      refreshAuthoritativeState();
    } catch (err) {
      setSubmitError(err.message || 'Lỗi khi gửi câu trả lời.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Exit Session
  const handleExit = () => {
    setSessionId(null);
    setParticipantId(null);
    setParticipantInfo(null);
    setSelectedOptionId(null);
    setHasSubmittedCurrentQuestion(false);
    setLastSubmittedQuestionId(null);
    setSubmitResult(null);
    setSubmitError(null);
    setRoomCode('');
  };

  // Option Letter Helpers
  const getOptionLetter = (index) => {
    return String.fromCharCode(65 + index); // 0 -> A, 1 -> B, 2 -> C, 3 -> D
  };

  // Find current student's score in leaderboard
  const studentLeaderboardEntry = useMemo(() => {
    if (!leaderboard || !participantId) return null;
    return leaderboard.find((item) => item.participant_id === participantId) || null;
  }, [leaderboard, participantId]);

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

  // 2. JOIN VIEW (State A & B)
  if (!sessionId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
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

  // 3. LOBBY VIEW (State C: Session Waiting)
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

  // 4. PAUSED STATE BANNER (State F)
  const isPaused = sessionData?.status === 'paused';

  // 5. FINISHED STATE (State G)
  if (sessionData?.status === 'finished') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl border-4 border-amber-300 shadow-lg p-6 sm:p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-tr from-amber-400 to-yellow-500 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-md border-2 border-white">
            <Trophy className="w-10 h-10 text-white" />
          </div>

          <h1 className="text-3xl font-black text-slate-800 mb-2">
            Đấu Trường Đã Hoàn Thành! 🏆
          </h1>
          <p className="text-slate-600 font-medium mb-6">
            Chúc mừng bạn đã hoàn thành phần thi. Dưới đây là bảng xếp hạng chung cuộc:
          </p>

          {/* Student Personal Achievement Badge */}
          {studentLeaderboardEntry && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-3 border-amber-300 rounded-2xl p-4 mb-8 flex items-center justify-around">
              <div className="text-center">
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wider">Hạng của bạn</div>
                <div className="text-2xl sm:text-3xl font-black text-amber-950 flex items-center justify-center gap-1">
                  #{studentLeaderboardEntry.rank || '—'}
                </div>
              </div>
              <div className="w-px h-10 bg-amber-200"></div>
              <div className="text-center">
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wider">Tổng điểm</div>
                <div className="text-2xl sm:text-3xl font-black text-emerald-600">
                  {studentLeaderboardEntry.total_score}
                </div>
              </div>
              <div className="w-px h-10 bg-amber-200"></div>
              <div className="text-center">
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wider">Số câu đúng</div>
                <div className="text-2xl sm:text-3xl font-black text-sky-600">
                  {studentLeaderboardEntry.correct_count}
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard Table */}
          <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl overflow-hidden mb-8 text-left">
            <div className="px-5 py-3 bg-slate-100 border-b-2 border-slate-200 flex items-center justify-between text-xs font-black text-slate-600 uppercase tracking-wider">
              <div className="w-16">Hạng</div>
              <div className="flex-1">Thí sinh</div>
              <div className="w-24 text-right">Điểm</div>
            </div>

            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {leaderboard.length === 0 ? (
                <div className="p-6 text-center text-sm font-bold text-slate-500">
                  Đang tải bảng xếp hạng...
                </div>
              ) : (
                leaderboard.map((item, idx) => {
                  const isCurrentStudent = item.participant_id === participantId;
                  return (
                    <div
                      key={item.participant_id || idx}
                      className={`px-5 py-3 flex items-center justify-between ${
                        isCurrentStudent ? 'bg-amber-100/70 font-black' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="w-16 flex items-center gap-1 font-black text-sm text-slate-700">
                        {item.rank === 1 && <Crown className="w-4 h-4 text-amber-500 fill-amber-400" />}
                        {item.rank === 2 && <Medal className="w-4 h-4 text-slate-400" />}
                        {item.rank === 3 && <Medal className="w-4 h-4 text-amber-700" />}
                        <span>#{item.rank || idx + 1}</span>
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
                          {item.display_name} {isCurrentStudent && <span className="text-xs text-amber-800 font-black">(Bạn)</span>}
                        </span>
                      </div>
                      <div className="w-24 text-right text-sm font-black text-emerald-600">
                        {item.total_score} đ
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <button
            onClick={handleExit}
            className="px-8 py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-black text-base rounded-2xl transition-all shadow-md active:scale-95"
          >
            Quay Về Trang Chủ
          </button>
        </div>
      </div>
    );
  }

  // 6. CANCELLED STATE (State H)
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

  // 7. ACTIVE QUESTION & SUBMITTED STATE (State D, E, F)
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
