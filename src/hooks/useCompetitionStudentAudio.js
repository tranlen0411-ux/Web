import { useState, useEffect, useRef, useCallback } from 'react';
import { useSound } from '../context/SoundContext.jsx';
import { competitionAudioManager, BACKGROUND_MUSIC_AVAILABLE } from '../services/competitionAudioManager.js';
import {
  getThemeById,
  getHeroicTrackById,
  DEFAULT_MUSIC_THEME,
  SELECTION_MODE_CUSTOM,
  SELECTION_MODE_THEME,
} from '../services/competitionMusicThemes.js';

/**
 * COMPETITION STUDENT AUDIO HOOK (Competition V1 - R19)
 *
 * Guaranteed Invariants:
 * - 100% Mute when mode === 'in_class' (Host main room speaker only)
 * - Synchronizes authoritative theme or custom tracks directly into competitionAudioManager
 * - Single background audio instance via competitionAudioManager
 * - Zero restart on Polling / Reconnect (Guarded via 5-Tuple compound key)
 * - Authoritative server signal for Results: isInterimLeaderboardActive (Zero host view mode coupling)
 * - Browser Autoplay compliance: Starts muted in online mode until explicit Student gesture
 * - Anti-stale SFX: Unlocking mid-question or after F5 does NOT replay question-open fanfare
 * - Safe Pause & Resume without track restart
 * - Fail-silent execution: Never blocks question taking or error displays
 */
export function useCompetitionStudentAudio({
  sessionId = null,
  status = 'waiting',
  currentQuestionId = null,
  timeLeftSeconds = null,
  isInterimLeaderboardActive = false,
  audioConfig = null,
}) {
  // Sync with global sound preference from repository SoundContext
  const { isSoundEnabled } = useSound();

  // Local student mute & volume preference (starts locked per session)
  const [isStudentAudioUnlocked, setIsStudentAudioUnlocked] = useState(false);
  const [needsPlaybackRetry, setNeedsPlaybackRetry] = useState(
    () => Boolean(competitionAudioManager.needsPlaybackRetry)
  );
  const [isStudentMuted, setIsStudentMuted] = useState(false);
  const [volume, setVolumeState] = useState(0.5);

  // Subscribe to audio manager retry updates (strictly updates retry flag, never alters session unlock)
  useEffect(() => {
    const handleRetry = (retryNeeded) => {
      setNeedsPlaybackRetry(Boolean(retryNeeded));
    };
    competitionAudioManager.addRetryListener?.(handleRetry);
    setNeedsPlaybackRetry(Boolean(competitionAudioManager.needsPlaybackRetry));
    return () => {
      competitionAudioManager.removeRetryListener?.(handleRetry);
    };
  }, []);

  // Session-bound audio config isolation: never leaks Room A config to Room B
  const lastKnownAudioConfigRef = useRef(null);
  const lastConfigSessionIdRef = useRef(sessionId);

  if (lastConfigSessionIdRef.current !== sessionId) {
    lastConfigSessionIdRef.current = sessionId;
    lastKnownAudioConfigRef.current = null;
  }

  if (audioConfig && typeof audioConfig === 'object') {
    lastKnownAudioConfigRef.current = audioConfig;
  }
  const effectiveConfig = (sessionId && lastConfigSessionIdRef.current === sessionId)
    ? (audioConfig || lastKnownAudioConfigRef.current)
    : null;

  // Extract config with in_class fallback
  const mode = effectiveConfig?.mode || 'in_class';
  const selectionMode = effectiveConfig?.selection_mode || 'theme';
  const themeId = effectiveConfig?.theme_id || DEFAULT_MUSIC_THEME;
  const customLobbyTrackId = effectiveConfig?.custom_lobby_track_id || null;
  const customQuestionTrackId = effectiveConfig?.custom_question_track_id || null;

  // Invariant 1: In-class mode enforces 100% client-side mute
  const isInClass = mode === 'in_class';

  // Synchronize authoritative tracks from session audioConfig into competitionAudioManager
  useEffect(() => {
    if (isInClass) {
      competitionAudioManager.stopAll();
      return;
    }
    // Only configure audio manager if in online mode
    if (selectionMode === SELECTION_MODE_CUSTOM) {
      competitionAudioManager.setSelectionMode(SELECTION_MODE_CUSTOM);
      competitionAudioManager.setCustomTracks({
        lobbyTrackId: customLobbyTrackId,
        questionTrackId: customQuestionTrackId,
      });
    } else {
      competitionAudioManager.setSelectionMode(SELECTION_MODE_THEME);
      competitionAudioManager.setTheme(themeId);
    }
  }, [isInClass, selectionMode, themeId, customLobbyTrackId, customQuestionTrackId]);

  // Determine actual playable tracks for local guard key
  const resolvedLobbyTrackSrc = selectionMode === SELECTION_MODE_CUSTOM
    ? (getHeroicTrackById(customLobbyTrackId)?.src || null)
    : (getThemeById(themeId)?.lobbyTrack || null);

  const resolvedQuestionTrackSrc = selectionMode === SELECTION_MODE_CUSTOM
    ? (getHeroicTrackById(customQuestionTrackId)?.src || null)
    : (getThemeById(themeId)?.questionTrack || null);

  // Determine current effective phase
  let currentPhase = 'INACTIVE';
  if (status === 'waiting') {
    currentPhase = 'LOBBY';
  } else if (status === 'in_progress') {
    if (isInterimLeaderboardActive) {
      currentPhase = 'QUESTION_RESULTS';
    } else if (timeLeftSeconds !== null && timeLeftSeconds <= 0) {
      currentPhase = 'TIME_UP';
    } else if (currentQuestionId) {
      currentPhase = 'QUESTION_ACTIVE';
    } else {
      currentPhase = 'QUESTION_LOADING';
    }
  } else if (status === 'paused') {
    currentPhase = 'PAUSED';
  } else if (status === 'finished') {
    currentPhase = 'FINISHED';
  }

  // Determine active track for the phase
  const activeTrackSrc = currentPhase === 'LOBBY'
    ? resolvedLobbyTrackSrc
    : (currentPhase === 'QUESTION_ACTIVE' ? resolvedQuestionTrackSrc : null);

  // Compound 5-Tuple Event Guard: Prevents duplicate triggers from Polling / F5 / Reconnect
  const lastCompoundKeyRef = useRef(null);
  const lastPlayedSfxSetRef = useRef(new Set());
  const prevSessionIdRef = useRef(sessionId);
  const prevQuestionIdRef = useRef(currentQuestionId);

  // Session reset & clean isolation across room switches
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      lastCompoundKeyRef.current = null;
      lastPlayedSfxSetRef.current.clear();
      lastKnownAudioConfigRef.current = null;
      setIsStudentAudioUnlocked(false);
      setNeedsPlaybackRetry(false);
      competitionAudioManager.stopAll();
    }
  }, [sessionId]);

  // Mount guard for F5 or late join: pre-consume all current and past SFX events
  useEffect(() => {
    if (currentQuestionId) {
      if (currentPhase === 'QUESTION_ACTIVE') {
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
      } else if (currentPhase === 'TIME_UP') {
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:TIME_UP`);
      } else if (currentPhase === 'QUESTION_RESULTS') {
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:TIME_UP`);
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_RESULTS`);
      }
    }
  }, []); // Run once on initial mount to prevent stale fanfare on F5

  // Question change reset & Late unlock guard
  useEffect(() => {
    if (prevQuestionIdRef.current !== currentQuestionId) {
      prevQuestionIdRef.current = currentQuestionId;
      if (currentQuestionId) {
        lastPlayedSfxSetRef.current.delete(`${sessionId}:${currentQuestionId}:TIME_UP`);
        lastPlayedSfxSetRef.current.delete(`${sessionId}:${currentQuestionId}:QUESTION_RESULTS`);
      }
    }

    // While audio is locked, pre-consume whichever SFX events occur
    // so clicking "Bật âm thanh" late (in QUESTION_ACTIVE, TIME_UP, or QUESTION_RESULTS)
    // will NOT fire past SFX!
    if (!isStudentAudioUnlocked && currentQuestionId) {
      if (currentPhase === 'QUESTION_ACTIVE') {
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
      } else if (currentPhase === 'TIME_UP') {
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:TIME_UP`);
      } else if (currentPhase === 'QUESTION_RESULTS') {
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:TIME_UP`);
        lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_RESULTS`);
      }
    }
  }, [currentQuestionId, currentPhase, sessionId, isStudentAudioUnlocked]);

  // Master Audio Execution Effect
  useEffect(() => {
    // 1. If in_class, globally disabled, or student muted -> STOP ALL & EXIT
    if (isInClass || !isSoundEnabled || isStudentMuted || !isStudentAudioUnlocked) {
      competitionAudioManager.stopAll();
      lastCompoundKeyRef.current = null;
      return;
    }

    // 2. PAUSED state
    if (currentPhase === 'PAUSED') {
      competitionAudioManager.setGamePaused(true);
      return;
    } else {
      competitionAudioManager.setGamePaused(false);
    }

    // 3. FINISHED or CANCELLED
    if (currentPhase === 'FINISHED' || status === 'cancelled') {
      competitionAudioManager.stopAll();
      return;
    }

    // 4. Construct 5-Tuple Invariant Guard Key
    const compoundKey = `${sessionId}:${currentQuestionId || 'pending'}:${currentPhase}:${selectionMode}:${activeTrackSrc || 'none'}`;

    // 5. Anti-restart guard for Polling rerenders
    if (lastCompoundKeyRef.current === compoundKey) {
      return; // Already in desired state; do not restart playback
    }
    lastCompoundKeyRef.current = compoundKey;

    // 6. State Machine Transitions
    if (currentPhase === 'LOBBY') {
      if (resolvedLobbyTrackSrc) {
        competitionAudioManager.playMusic('lobby');
      } else {
        competitionAudioManager.stopMusic();
      }
    } else if (currentPhase === 'QUESTION_LOADING') {
      // Holding phase: clean transition from lobby without premature question sound triggers
      competitionAudioManager.stopMusic();
    } else if (currentPhase === 'QUESTION_ACTIVE') {
      const openKey = `${sessionId}:${currentQuestionId}:QUESTION_OPEN`;
      if (!lastPlayedSfxSetRef.current.has(openKey)) {
        lastPlayedSfxSetRef.current.add(openKey);
        competitionAudioManager.playSfx('competition_question_open');
      }
      if (resolvedQuestionTrackSrc) {
        competitionAudioManager.playMusic('question_active');
      } else {
        competitionAudioManager.stopMusic();
      }
    } else if (currentPhase === 'TIME_UP') {
      const timeUpKey = `${sessionId}:${currentQuestionId}:TIME_UP`;
      competitionAudioManager.stopMusic();
      if (!lastPlayedSfxSetRef.current.has(timeUpKey)) {
        lastPlayedSfxSetRef.current.add(timeUpKey);
        competitionAudioManager.playSfx('competition_time_up');
      }
    } else if (currentPhase === 'QUESTION_RESULTS') {
      const resultsKey = `${sessionId}:${currentQuestionId}:QUESTION_RESULTS`;
      competitionAudioManager.stopMusic();
      if (!lastPlayedSfxSetRef.current.has(resultsKey)) {
        lastPlayedSfxSetRef.current.add(resultsKey);
        competitionAudioManager.playSfx('competition_results_reveal');
      }
    }
  }, [
    sessionId,
    status,
    currentPhase,
    currentQuestionId,
    isInClass,
    isSoundEnabled,
    isStudentMuted,
    isStudentAudioUnlocked,
    selectionMode,
    activeTrackSrc,
    resolvedLobbyTrackSrc,
    resolvedQuestionTrackSrc,
  ]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      competitionAudioManager.setGamePaused(false);
      competitionAudioManager.stopAll();
    };
  }, []);

  // Explicit user gesture unlock for browser Autoplay compliance
  const unlockStudentAudio = useCallback(async () => {
    const unlocked = await competitionAudioManager.unlock();
    setIsStudentAudioUnlocked(unlocked);
    setIsStudentMuted(false);
    setNeedsPlaybackRetry(Boolean(competitionAudioManager.needsPlaybackRetry));
    return unlocked;
  }, []);

  // Dedicated recovery action based on valid user gesture
  const retryStudentAudio = useCallback(async () => {
    const unlocked = await competitionAudioManager.unlock();
    setIsStudentAudioUnlocked(unlocked);
    setIsStudentMuted(false);
    setNeedsPlaybackRetry(Boolean(competitionAudioManager.needsPlaybackRetry));
    return unlocked;
  }, []);

  const toggleStudentMute = useCallback(() => {
    setIsStudentMuted((prev) => {
      const next = !prev;
      competitionAudioManager.setMusicEnabled(!next);
      return next;
    });
  }, []);

  const setVolume = useCallback((newVol) => {
    const clamped = Math.max(0, Math.min(1, typeof newVol === 'number' ? newVol : 0.5));
    setVolumeState(clamped);
    competitionAudioManager.setVolume(clamped);
  }, []);

  return {
    isInClass,
    isOnline: mode === 'online',
    isStudentAudioUnlocked,
    needsPlaybackRetry,
    unlockStudentAudio,
    retryStudentAudio,
    isStudentMuted,
    toggleStudentMute,
    volume,
    setVolume,
    isMusicAvailable: BACKGROUND_MUSIC_AVAILABLE,
    currentPhase,
  };
}
