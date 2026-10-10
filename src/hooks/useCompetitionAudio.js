import { useState, useEffect, useRef, useCallback } from 'react';
import { useSound } from '../context/SoundContext.jsx';
import { competitionAudioManager, BACKGROUND_MUSIC_AVAILABLE } from '../services/competitionAudioManager.js';

/**
 * Custom React Hook for Competition Host Audio (Music & Sound Effects V1)
 *
 * Guaranteed Invariants:
 * - 100% Host-Only (zero student / spectator audio execution)
 * - Zero second AudioContext (reuses shared context from soundEffects.js)
 * - Respects repository global sound_enabled from SoundContext
 * - Zero extra Competition timer created (presentation-only sync with host timer)
 * - Sound duplicate on polling: PREVENTED BY DESIGN via Compound Event Key guards
 * - Countdown duplicate: PREVENTED BY DESIGN via per-second tick key guards
 * - Historical results navigation: ZERO sound playback on cached review
 * - Leaderboard SFX: exactly once per intentional open gesture
 * - Podium fanfare: exactly once per finished session
 * - Safe fail-silent audio failure (never blocks or errors game loop)
 * - Safe lifecycle cleanup on session change & component unmount
 */
export function useCompetitionAudio({
  sessionId,
  status = 'setup',
  hostViewMode = 'LIVE_QUESTION',
  currentQuestionId = null,
  timeLeftSeconds = null,
  isLeaderboardOpen = false,
  finishedTab = 'PODIUM',
  isReviewingHistory = false,
}) {
  // Sync with global sound preference from repository SoundContext
  const { isSoundEnabled, toggleSound } = useSound();

  // Local sub-controls (component / session state, NOT mutating localStorage)
  const [isMusicEnabled, setIsMusicEnabledState] = useState(true);
  const [isSfxEnabled, setIsSfxEnabledState] = useState(true);
  const [volume, setVolumeState] = useState(0.5);
  const [isUnlocked, setIsUnlocked] = useState(false);

  // Synchronize global sound preference into audio manager
  useEffect(() => {
    competitionAudioManager.setGlobalSoundEnabled(isSoundEnabled);
  }, [isSoundEnabled]);

  // Synchronize local controls into manager on mount
  useEffect(() => {
    competitionAudioManager.setMusicEnabled(isMusicEnabled);
    competitionAudioManager.setSfxEnabled(isSfxEnabled);
    competitionAudioManager.setVolume(volume);
  }, []);

  // Synchronize local sub-controls into audio manager
  const setMusicEnabled = useCallback((enabled) => {
    setIsMusicEnabledState(enabled);
    competitionAudioManager.setMusicEnabled(enabled);
  }, []);

  const setSfxEnabled = useCallback((enabled) => {
    setIsSfxEnabledState(enabled);
    competitionAudioManager.setSfxEnabled(enabled);
  }, []);

  const setVolume = useCallback((newVol) => {
    const clamped = Math.max(0, Math.min(1, typeof newVol === 'number' ? newVol : 0.5));
    setVolumeState(clamped);
    competitionAudioManager.setVolume(clamped);
  }, []);

  // Explicit unlock callback on user gesture (Top-bar button or Start Session click)
  const unlockAudio = useCallback(async () => {
    const unlocked = await competitionAudioManager.unlock();
    setIsUnlocked(unlocked);
    return unlocked;
  }, []);

  // Semantic audio action: Manual host question close triggers guarded TIME_UP event
  const triggerQuestionClosed = useCallback(() => {
    if (!sessionId || !currentQuestionId) return;
    const timeUpKey = `${sessionId}:${currentQuestionId}:TIME_UP`;
    if (!lastPlayedEventsRef.current.has(timeUpKey)) {
      lastPlayedEventsRef.current.add(timeUpKey);
      competitionAudioManager.stopMusic();
      competitionAudioManager.playSfx('competition_time_up');
    }
  }, [sessionId, currentQuestionId]);

  // Event Guard Refs
  const lastPlayedEventsRef = useRef(new Set()); // `${sessionId}:${questionId}:${eventPhase}`
  const lastCountdownTickKeyRef = useRef(null); // `${questionId}:${remaining}`
  const lastLeaderboardOpenRef = useRef(Boolean(isLeaderboardOpen));
  const podiumPlayedSessionRef = useRef(null); // sessionId
  const prevQuestionIdRef = useRef(currentQuestionId);
  const prevSessionIdRef = useRef(sessionId);
  const prevStatusRef = useRef(status);

  // 1. Session ID change guard: reset all event guards & stop active music
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      lastPlayedEventsRef.current.clear();
      lastCountdownTickKeyRef.current = null;
      podiumPlayedSessionRef.current = null;
      lastLeaderboardOpenRef.current = Boolean(isLeaderboardOpen);
      competitionAudioManager.setGamePaused(false);
      competitionAudioManager.stopAll();
    }
  }, [sessionId, isLeaderboardOpen]);

  // 2. Question ID change guard: reset countdown tick guard for new question
  useEffect(() => {
    if (prevQuestionIdRef.current !== currentQuestionId) {
      prevQuestionIdRef.current = currentQuestionId;
      lastCountdownTickKeyRef.current = null;
    }
  }, [currentQuestionId]);

  // 3. Pause / Resume / Transitions effect
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (!sessionId) {
      competitionAudioManager.stopAll();
      return;
    }

    if (status === 'paused') {
      competitionAudioManager.setGamePaused(true);
      return;
    }

    if (status === 'in_progress' && prevStatus === 'paused') {
      competitionAudioManager.setGamePaused(false);
      return;
    }

    if (status === 'cancelled') {
      competitionAudioManager.stopAll();
      return;
    }

    // WAITING (Lobby)
    if (status === 'waiting') {
      competitionAudioManager.playMusic('lobby');
      return;
    }

    // LIVE QUESTION OPEN
    if (
      status === 'in_progress' &&
      hostViewMode === 'LIVE_QUESTION' &&
      currentQuestionId &&
      !isReviewingHistory
    ) {
      const openKey = `${sessionId}:${currentQuestionId}:QUESTION_OPEN`;
      if (!lastPlayedEventsRef.current.has(openKey)) {
        lastPlayedEventsRef.current.add(openKey);
        competitionAudioManager.playSfx('competition_question_open');
        competitionAudioManager.playMusic('question_active');
      }
      return;
    }

    // QUESTION RESULTS (Authoritative live close transition only; ZERO sound on historical review)
    if (
      hostViewMode === 'QUESTION_RESULTS' &&
      !isReviewingHistory &&
      currentQuestionId
    ) {
      const resultsKey = `${sessionId}:${currentQuestionId}:QUESTION_RESULTS`;
      if (!lastPlayedEventsRef.current.has(resultsKey)) {
        lastPlayedEventsRef.current.add(resultsKey);
        competitionAudioManager.stopMusic();
        competitionAudioManager.playSfx('competition_results_reveal');
      }
      return;
    }

    // FINISHED & PODIUM (Exactly once per finished session)
    if (
      status === 'finished' &&
      finishedTab === 'PODIUM'
    ) {
      if (podiumPlayedSessionRef.current !== sessionId) {
        podiumPlayedSessionRef.current = sessionId;
        competitionAudioManager.stopMusic();
        competitionAudioManager.playSfx('competition_podium');
      }
    }
  }, [
    sessionId,
    status,
    hostViewMode,
    currentQuestionId,
    finishedTab,
    isReviewingHistory,
  ]);

  // 4. Countdown SFX Effect (Final 5 seconds only, per-second guard, ZERO timer creation)
  useEffect(() => {
    if (
      status !== 'in_progress' ||
      hostViewMode !== 'LIVE_QUESTION' ||
      isReviewingHistory ||
      !currentQuestionId ||
      timeLeftSeconds === null ||
      timeLeftSeconds === undefined
    ) {
      return;
    }

    const remaining = Number(timeLeftSeconds);
    if (!Number.isFinite(remaining)) return;

    if (remaining <= 5 && remaining > 0) {
      const tickKey = `${currentQuestionId}:${remaining}`;
      if (lastCountdownTickKeyRef.current !== tickKey) {
        lastCountdownTickKeyRef.current = tickKey;
        const sfx = remaining === 1 ? 'competition_countdown_final' : 'competition_countdown_tick';
        competitionAudioManager.playSfx(sfx);
      }
    } else if (remaining === 0) {
      const timeUpKey = `${sessionId}:${currentQuestionId}:TIME_UP`;
      if (!lastPlayedEventsRef.current.has(timeUpKey)) {
        lastPlayedEventsRef.current.add(timeUpKey);
        competitionAudioManager.stopMusic();
        competitionAudioManager.playSfx('competition_time_up');
      }
    }
  }, [
    sessionId,
    status,
    hostViewMode,
    isReviewingHistory,
    currentQuestionId,
    timeLeftSeconds,
  ]);

  // 5. Leaderboard intentional open gesture guard (1 SFX per deliberate open transition)
  useEffect(() => {
    const wasOpen = lastLeaderboardOpenRef.current;
    lastLeaderboardOpenRef.current = Boolean(isLeaderboardOpen);

    if (isLeaderboardOpen && !wasOpen && sessionId) {
      competitionAudioManager.playSfx('competition_leaderboard');
    }
  }, [isLeaderboardOpen, sessionId]);

  // 6. Component unmount cleanup
  useEffect(() => {
    return () => {
      competitionAudioManager.setGamePaused(false);
      competitionAudioManager.stopAll();
    };
  }, []);

  return {
    isUnlocked,
    unlockAudio,
    isSoundEnabled,
    toggleSound,
    isMusicEnabled,
    setMusicEnabled,
    isSfxEnabled,
    setSfxEnabled,
    volume,
    setVolume,
    isMusicAvailable: BACKGROUND_MUSIC_AVAILABLE,
    triggerQuestionClosed,
  };
}
