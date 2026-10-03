import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Users,
  Play,
  Pause,
  SkipForward,
  CheckCircle,
  XCircle,
  Plus,
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
  Award
} from 'lucide-react';
import {
  hostCreateSession,
  hostStartSession,
  hostPauseSession,
  hostResumeSession,
  hostNextQuestion,
  hostFinishSession,
  hostCancelSession,
  getLeaderboardSnapshot
} from '../services/competitionClient.js';
import { useHostCompetitionPolling } from '../hooks/useHostCompetitionPolling.js';

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

export function CompetitionHostPage() {
  // Navigation & Session State
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [createdQuestionCount, setCreatedQuestionCount] = useState(3);
  const [notification, setNotification] = useState(null);
  const [actionPending, setActionPending] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'cancel' | 'finish', title, message, onConfirm }
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Setup Form State
  const [title, setTitle] = useState('Đấu Trường Tri Thức V1');
  const [description, setDescription] = useState('Phòng thi đấu vui học dành cho các bạn học sinh.');
  const [maxParticipants, setMaxParticipants] = useState(30);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [setupError, setSetupError] = useState(null);

  // Polling Hook for Active Session
  const {
    snapshot,
    participants,
    isLoading: isPollingLoading,
    error: pollingError,
    refreshNow,
    setSnapshot
  } = useHostCompetitionPolling(activeSessionId);

  // Auto show notification banner
  const showToast = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Determine current active state
  const currentStatus = snapshot?.status || (activeSessionId ? 'waiting' : 'setup');

  // Load Leaderboard data on demand
  const fetchLeaderboard = async () => {
    if (!activeSessionId) return;
    setIsLeaderboardLoading(true);
    try {
      const res = await getLeaderboardSnapshot({ sessionId: activeSessionId });
      if (res.success && Array.isArray(res.data?.leaderboard)) {
        setLeaderboardData(res.data.leaderboard);
      } else {
        showToast(res.message || 'Chưa thể tải dữ liệu bảng xếp hạng.', 'error');
      }
    } catch (_err) {
      showToast('Lỗi mạng khi tải bảng xếp hạng.', 'error');
    } finally {
      setIsLeaderboardLoading(false);
    }
  };

  // Trigger Leaderboard fetch when opening panel
  useEffect(() => {
    if (isLeaderboardOpen && activeSessionId) {
      fetchLeaderboard();
    }
  }, [isLeaderboardOpen, activeSessionId]);

  // Handle Question Builder Updates
  const handleAddQuestion = () => {
    if (questions.length >= 5) {
      showToast('Chỉ được tạo tối đa 5 câu hỏi trong phiên thi này.', 'warning');
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
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].text.trim()) {
          setSetupError(`Phương án ${j + 1} của câu hỏi ${i + 1} không được để trống.`);
          return;
        }
      }
      if (!q.correct_answer?.option_id) {
        setSetupError(`Vui lòng chọn đáp án đúng cho câu hỏi số ${i + 1}.`);
        return;
      }
    }

    setActionPending(true);
    try {
      const res = await hostCreateSession({
        title: trimmedTitle,
        description: description.trim() || null,
        mode: 'individual',
        maxParticipants: parseInt(maxParticipants, 10) || 30,
        questions: questions.map((q, idx) => ({
          question_order: idx + 1,
          question_text: q.question_text.trim(),
          question_type: 'single_choice',
          points: parseFloat(q.points) || 10.00,
          time_limit_seconds: parseInt(q.time_limit_seconds, 10) || 30,
          options: q.options.map(opt => ({ id: opt.id, text: opt.text.trim() })),
          correct_answer: { option_id: q.correct_answer.option_id }
        }))
      });

      if (res.success && res.data?.session?.id) {
        setActiveSessionId(res.data.session.id);
        setCreatedQuestionCount(questions.length);
        setSnapshot(res.data.session);
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

  const handleNextQuestion = async () => {
    if (!activeSessionId || actionPending) return;
    setActionPending(true);
    try {
      const res = await hostNextQuestion(activeSessionId);
      if (res.success) {
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
        showToast('Phòng thi đã kết thúc và tính toán thứ hạng hoàn tất!', 'success');
        await refreshNow();
        fetchLeaderboard();
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

  const handleResetToSetup = () => {
    setActiveSessionId(null);
    setQuestions(DEFAULT_QUESTIONS);
    setLeaderboardData([]);
    setIsLeaderboardOpen(false);
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
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
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
              <p className="text-sm text-slate-500">Quản trị và điều phối phòng thi đấu trực tiếp dành cho Giáo viên & Admin</p>
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
                Bảng Xếp Hạng
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
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{pollingError}</span>
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

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>Chế độ thi đấu: <strong className="text-slate-800">Cá nhân (Individual)</strong></span>
                <span>Phần thưởng: <strong className="text-slate-800">Tắt (Off)</strong></span>
              </div>
            </div>

            {/* Question Builder Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-sky-500" />
                    2. Soạn câu hỏi đấu trường ({questions.length}/5 câu)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Mỗi câu hỏi có 4 lựa chọn A, B, C, D và chọn 1 đáp án đúng duy nhất.</p>
                </div>

                <button
                  type="button"
                  onClick={handleAddQuestion}
                  disabled={questions.length >= 5}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 text-sky-700 font-semibold text-xs hover:bg-sky-100 disabled:opacity-50 transition border border-sky-200"
                >
                  <Plus className="w-4 h-4" />
                  Thêm Câu Hỏi
                </button>
              </div>

              <div className="space-y-6">
                {questions.map((q, qIdx) => (
                  <div key={qIdx} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-3 py-1 rounded-lg bg-amber-500 text-white font-bold text-xs shadow-sm">
                        Câu {q.question_order}
                      </span>

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

                    {/* Options List */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {q.options.map((opt, optIdx) => {
                        const isCorrect = q.correct_answer?.option_id === opt.id;
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
                            <input
                              type="radio"
                              name={`correct_q_${qIdx}`}
                              checked={isCorrect}
                              onChange={() => handleSelectCorrectOption(qIdx, opt.id)}
                              className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              title="Đánh dấu đây là đáp án đúng"
                            />
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
                  <button
                    type="button"
                    onClick={() => handleCopyRoomCode(snapshot.room_code)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-white/80 px-2.5 py-1 rounded-lg border border-amber-300 shadow-xs"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedCode ? 'Đã sao chép!' : 'Sao chép mã'}
                  </button>
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
            {/* Live Status Bar */}
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
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">Tiến độ câu hỏi</span>
                    <span className="text-lg font-black text-sky-700">
                      Câu {snapshot.current_question_index || 1} / {createdQuestionCount}
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

              {/* Host Control Actions Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {currentStatus === 'in_progress' ? (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handlePauseSession}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm shadow-sm transition disabled:opacity-50"
                  >
                    <Pause className="w-4 h-4" />
                    Tạm Dừng
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handleResumeSession}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition disabled:opacity-50"
                  >
                    <Play className="w-4 h-4" />
                    Tiếp Tục
                  </button>
                )}

                <button
                  type="button"
                  disabled={actionPending}
                  onClick={handleNextQuestion}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-sm transition disabled:opacity-50"
                >
                  <SkipForward className="w-4 h-4" />
                  Câu Tiếp Theo
                </button>

                <button
                  type="button"
                  disabled={actionPending}
                  onClick={() => setConfirmModal({
                    type: 'finish',
                    title: 'Xác nhận kết thúc phòng thi',
                    message: 'Bạn có chắc chắn muốn kết thúc trận đấu ngay bây giờ và tính toán thứ hạng chung cuộc?',
                    onConfirm: handleFinishSession
                  })}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm shadow-sm transition disabled:opacity-50"
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
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-red-300 text-red-600 hover:bg-red-50 font-bold text-sm transition disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Hủy Trận
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STATE E: FINISHED SCREEN                                     */}
        {/* ============================================================ */}
        {currentStatus === 'finished' && snapshot && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 mx-auto shadow-md">
              <Trophy className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-2xl font-black text-slate-800">Đấu Trường Đã Hoàn Thành!</h2>
              <p className="text-xs text-slate-500 mt-1">Phiên thi đấu "{snapshot.title}" đã kết thúc và tính toán thứ hạng.</p>
            </div>

            {/* Final Leaderboard Display */}
            <div className="max-w-2xl mx-auto text-left space-y-3">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 border-b border-slate-100 pb-2">
                <Award className="w-4 h-4 text-amber-500" />
                Bảng Xếp Hạng Chung Cuộc
              </h3>

              {leaderboardData.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  <button
                    type="button"
                    onClick={fetchLeaderboard}
                    className="text-amber-600 hover:underline font-semibold"
                  >
                    Bấm vào đây để tải bảng xếp hạng
                  </button>
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
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleResetToSetup}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition"
              >
                <RotateCcw className="w-4 h-4" />
                Tạo Đấu Trường Mới
              </button>
            </div>
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
        {/* LEADERBOARD DRAWER / PANEL                                   */}
        {/* ============================================================ */}
        {isLeaderboardOpen && activeSessionId && currentStatus !== 'finished' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Bảng Xếp Hạng Trực Tiếp
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
  );
}

export default CompetitionHostPage;

