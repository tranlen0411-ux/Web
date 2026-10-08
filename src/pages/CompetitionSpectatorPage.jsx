import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Maximize,
  Minimize,
  Tv
} from 'lucide-react';
import {
  getSessionSnapshot,
  getLeaderboardSnapshot,
  getHostSessionMetadata,
  getActiveQuestionSnapshot,
  getHostSubmissionStats,
  getHostQuestionResults,
  getHostQuestionResultByOrder,
  getSessionParticipants,
  isValidSessionUUID
} from '../services/competitionClient.js';
import { SpectatorWaitingView } from '../components/competition/spectator/SpectatorWaitingView.jsx';
import { SpectatorLiveQuestionView } from '../components/competition/spectator/SpectatorLiveQuestionView.jsx';
import { SpectatorQuestionResultsView } from '../components/competition/spectator/SpectatorQuestionResultsView.jsx';
import { SpectatorLeaderboardView } from '../components/competition/spectator/SpectatorLeaderboardView.jsx';
import { SpectatorFinishedView } from '../components/competition/spectator/SpectatorFinishedView.jsx';

export function CompetitionSpectatorPage() {
  const [searchParams] = useSearchParams();
  const rawSessionId = searchParams.get('sessionId');
  const sessionId = rawSessionId ? rawSessionId.trim() : '';
  const isValidUUID = isValidSessionUUID(sessionId);

  // Core Data States
  const [snapshot, setSnapshot] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [submissionStats, setSubmissionStats] = useState(null);
  const [questionResults, setQuestionResults] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [participants, setParticipants] = useState([]);

  // UI & Presentation States
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(null);
  const [localViewMode, setLocalViewMode] = useState('auto'); // 'auto' | 'live' | 'results' | 'leaderboard'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Lifecycle & Stale-Request Guard Refs
  const activeRequestIdRef = useRef(0);
  const isFetchingRef = useRef(false);
  const timerIntervalRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  // Fullscreen sync listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch (_err) {
      // Graceful fallback if unsupported
    }
  };

  // Safe Data Fetcher with Stale-Response Guard
  const fetchSpectatorData = useCallback(async (isInitial = false) => {
    if (!sessionId || !isValidUUID || !isMountedRef.current) return;
    if (isFetchingRef.current && !isInitial) return;

    const currentRequestId = ++activeRequestIdRef.current;
    isFetchingRef.current = true;

    try {
      // 1. Fetch Session Snapshot (Read-only RLS select)
      const sessionRes = await getSessionSnapshot(sessionId);
      if (!isMountedRef.current || currentRequestId !== activeRequestIdRef.current) return;

      if (!sessionRes.success || !sessionRes.data) {
        if (isInitial || !snapshot) {
          setErrorMessage(sessionRes.message || 'Không tìm thấy phòng thi hoặc bạn không có quyền truy cập.');
        }
        return;
      }

      const currentSession = sessionRes.data;
      setSnapshot(currentSession);
      setErrorMessage(null);

      // 2. Fetch Authoritative Session Metadata (total_questions)
      const metaRes = await getHostSessionMetadata(sessionId);
      if (isMountedRef.current && currentRequestId === activeRequestIdRef.current && metaRes.success && metaRes.data) {
        setMetadata(metaRes.data);
      }

      // 3. Conditional Snapshot Reads by Session Status
      if (currentSession.status === 'waiting') {
        const partRes = await getSessionParticipants(sessionId);
        if (isMountedRef.current && currentRequestId === activeRequestIdRef.current && partRes.success) {
          setParticipants(partRes.data || []);
        }
      } else if (currentSession.status === 'in_progress' || currentSession.status === 'paused') {
        const deadline = currentSession.question_deadline ? new Date(currentSession.question_deadline).getTime() : null;
        const isPastDeadline = deadline ? (Date.now() >= deadline) : false;

        const promises = [
          getActiveQuestionSnapshot({ sessionId }),
          getHostSubmissionStats(sessionId),
          getLeaderboardSnapshot({ sessionId }),
          getSessionParticipants(sessionId)
        ];

        if (isPastDeadline) {
          promises.push(getHostQuestionResults(sessionId));
        }

        const settled = await Promise.allSettled(promises);
        if (!isMountedRef.current || currentRequestId !== activeRequestIdRef.current) return;

        if (settled[0].status === 'fulfilled' && settled[0].value?.success) {
          setActiveQuestion(settled[0].value.data);
        }
        if (settled[1].status === 'fulfilled' && settled[1].value?.success) {
          setSubmissionStats(settled[1].value.data);
        }
        if (settled[2].status === 'fulfilled' && settled[2].value?.success) {
          setLeaderboard(settled[2].value.data || []);
        }
        if (settled[3].status === 'fulfilled' && settled[3].value?.success) {
          setParticipants(settled[3].value.data || []);
        }
        if (isPastDeadline && settled[4] && settled[4].status === 'fulfilled' && settled[4].value?.success) {
          setQuestionResults(settled[4].value.data);
        } else if (!isPastDeadline) {
          setQuestionResults(null);
        }
      } else if (currentSession.status === 'finished') {
        const [lbRes, partRes, resRes] = await Promise.allSettled([
          getLeaderboardSnapshot({ sessionId }),
          getSessionParticipants(sessionId),
          getHostQuestionResults(sessionId)
        ]);
        if (!isMountedRef.current || currentRequestId !== activeRequestIdRef.current) return;

        if (lbRes.status === 'fulfilled' && lbRes.value?.success) {
          setLeaderboard(lbRes.value.data || []);
        }
        if (partRes.status === 'fulfilled' && partRes.value?.success) {
          setParticipants(partRes.data || []);
        }
        if (resRes.status === 'fulfilled' && resRes.value?.success) {
          setQuestionResults(resRes.value.data);
        }
      }
    } catch (err) {
      if (isMountedRef.current && currentRequestId === activeRequestIdRef.current) {
        if (isInitial) {
          setErrorMessage(err.message || 'Lỗi kết nối khi tải dữ liệu trình chiếu.');
        }
      }
    } finally {
      if (isMountedRef.current && currentRequestId === activeRequestIdRef.current) {
        isFetchingRef.current = false;
        if (isInitial) setLoading(false);
      }
    }
  }, [sessionId, isValidUUID, snapshot]);

  // Controlled Polling Setup (Active = 2s, Waiting/Paused/Finished = 3s)
  useEffect(() => {
    isMountedRef.current = true;
    if (!sessionId || !isValidUUID) {
      setLoading(false);
      return;
    }

    fetchSpectatorData(true);

    const schedulePoll = () => {
      if (!isMountedRef.current) return;
      const interval = (snapshot?.status === 'in_progress') ? 2000 : 3000;
      pollingTimerRef.current = setTimeout(async () => {
        await fetchSpectatorData(false);
        schedulePoll();
      }, interval);
    };

    schedulePoll();

    return () => {
      isMountedRef.current = false;
      if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [sessionId, isValidUUID, fetchSpectatorData, snapshot?.status]);

  // Local Countdown Timer Tick
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    if (snapshot?.status === 'in_progress' && snapshot?.question_deadline) {
      const updateTimer = () => {
        const deadline = new Date(snapshot.question_deadline).getTime();
        const now = Date.now();
        const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
        setTimeLeftSeconds(remaining);
      };
      updateTimer();
      timerIntervalRef.current = setInterval(updateTimer, 1000);
    } else if (snapshot?.status === 'paused') {
      // Freeze timer in paused state
    } else {
      setTimeLeftSeconds(null);
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [snapshot?.status, snapshot?.question_deadline]);

  // Fail-closed screen for invalid session ID or load error
  if (!isValidUUID || errorMessage) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-slate-900 border border-red-500/30 rounded-3xl p-8 text-center space-y-6 shadow-2xl shadow-red-950/50">
          <div className="w-20 h-20 rounded-2xl bg-red-900/40 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto shadow-inner">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Không Thể Mở Màn Hình Trình Chiếu
            </h1>
            <p className="text-sm text-slate-400 mt-2">
              {errorMessage || 'Mã định danh phòng thi không hợp lệ hoặc thiếu thông tin phiên thi.'}
            </p>
          </div>
          <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-800 text-xs font-mono text-slate-400 break-all text-left">
            <div><strong>Session ID:</strong> {sessionId || '(Không có)'}</div>
            <div className="mt-1"><strong>Trạng thái:</strong> Fail-Closed (Bảo vệ an toàn)</div>
          </div>
          <p className="text-xs text-slate-500">
            Vui lòng kiểm tra lại đường dẫn hoặc mở lại từ bảng điều khiển Host.
          </p>
        </div>
      </div>
    );
  }

  // Initial loading spinner
  if (loading && !snapshot) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-lg font-bold text-amber-400 animate-pulse">
            Đang tải dữ liệu màn hình trình chiếu...
          </p>
        </div>
      </div>
    );
  }

  // Derived Effective Total Questions
  const effectiveTotalQuestions = metadata?.total_questions || snapshot?.max_questions || snapshot?.current_question_index || 1;

  // Determine Effective View Mode
  const isQuestionClosed = timeLeftSeconds === 0 || (snapshot?.question_deadline && Date.now() >= new Date(snapshot.question_deadline).getTime());
  let effectiveView = 'waiting';

  if (snapshot?.status === 'waiting') {
    effectiveView = 'waiting';
  } else if (snapshot?.status === 'in_progress' || snapshot?.status === 'paused') {
    if (localViewMode === 'results' || (localViewMode === 'auto' && isQuestionClosed && questionResults)) {
      effectiveView = 'results';
    } else if (localViewMode === 'leaderboard') {
      effectiveView = 'leaderboard';
    } else {
      effectiveView = 'live';
    }
  } else if (snapshot?.status === 'finished') {
    if (localViewMode === 'results' && questionResults) {
      effectiveView = 'results';
    } else if (localViewMode === 'leaderboard') {
      effectiveView = 'leaderboard';
    } else {
      effectiveView = 'finished';
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between select-none overflow-x-hidden font-sans">
      {/* Top Projector Navigation & Floating Controls */}
      <header className="w-full px-6 py-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white shadow-lg shadow-amber-900/30">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-extrabold tracking-widest text-amber-400">
                Màn Hình Trình Chiếu
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-800 border border-slate-700 text-slate-300">
                Read-Only
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white truncate max-w-[280px] sm:max-w-md">
              {snapshot?.title || 'Đấu Trường Trực Tiếp'}
            </h1>
          </div>
        </div>

        {/* Center / Right Control Actions (Local Presentation Switchers - ZERO Backend Calls) */}
        <div className="flex items-center gap-2 sm:gap-3">
          {snapshot?.status !== 'waiting' && (
            <div className="hidden md:flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 text-xs font-bold">
              <button
                type="button"
                onClick={() => setLocalViewMode('auto')}
                className={`px-3 py-1.5 rounded-lg transition ${localViewMode === 'auto' ? 'bg-amber-500 text-slate-950 shadow-xs' : 'text-slate-400 hover:text-white'}`}
              >
                Tự Động
              </button>
              <button
                type="button"
                onClick={() => setLocalViewMode('live')}
                className={`px-3 py-1.5 rounded-lg transition ${localViewMode === 'live' ? 'bg-amber-500 text-slate-950 shadow-xs' : 'text-slate-400 hover:text-white'}`}
              >
                Câu Hỏi
              </button>
              {questionResults && (
                <button
                  type="button"
                  onClick={() => setLocalViewMode('results')}
                  className={`px-3 py-1.5 rounded-lg transition ${localViewMode === 'results' ? 'bg-amber-500 text-slate-950 shadow-xs' : 'text-slate-400 hover:text-white'}`}
                >
                  Kết Quả
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocalViewMode('leaderboard')}
                className={`px-3 py-1.5 rounded-lg transition ${localViewMode === 'leaderboard' ? 'bg-amber-500 text-slate-950 shadow-xs' : 'text-slate-400 hover:text-white'}`}
              >
                Bảng Xếp Hạng
              </button>
            </div>
          )}

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition shadow-sm"
            title="Toàn màn hình"
          >
            {isFullscreen ? <Minimize className="w-4 h-4 text-amber-400" /> : <Maximize className="w-4 h-4 text-amber-400" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Thu Nhỏ' : 'Toàn Màn Hình'}</span>
          </button>
        </div>
      </header>

      {/* Main Presentation Viewport */}
      <main className="flex-grow flex items-center justify-center p-4 sm:p-8 md:p-12">
        {effectiveView === 'waiting' && (
          <SpectatorWaitingView
            snapshot={snapshot}
            participants={participants}
          />
        )}

        {effectiveView === 'live' && (
          <SpectatorLiveQuestionView
            snapshot={snapshot}
            activeQuestion={activeQuestion}
            effectiveTotalQuestions={effectiveTotalQuestions}
            submissionStats={submissionStats}
            participantsCount={participants.length}
            timeLeftSeconds={timeLeftSeconds}
          />
        )}

        {effectiveView === 'results' && (
          <SpectatorQuestionResultsView
            snapshot={snapshot}
            activeQuestion={activeQuestion}
            questionResults={questionResults}
            participantsCount={participants.length}
          />
        )}

        {effectiveView === 'leaderboard' && (
          <SpectatorLeaderboardView
            leaderboard={leaderboard}
          />
        )}

        {effectiveView === 'finished' && (
          <SpectatorFinishedView
            leaderboard={leaderboard}
          />
        )}
      </main>

      {/* Footer Meta Bar */}
      <footer className="w-full px-6 py-3 border-t border-slate-800/60 bg-slate-950/80 text-xs text-slate-500 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span>Mã phòng: <strong className="font-mono text-slate-300">{snapshot?.room_code}</strong></span>
          <span>Chế độ: <strong className="text-slate-300">{snapshot?.mode === 'team' ? 'Đấu Đội' : 'Cá Nhân'}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
          <span>Cập nhật tự động</span>
        </div>
      </footer>
    </div>
  );
}

export default CompetitionSpectatorPage;
