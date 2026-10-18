import { getAudioContext, playSound } from '../utils/soundEffects.js';
import {
  DEFAULT_MUSIC_THEME,
  getThemeById,
  isValidThemeId,
  isSelectableThemeId,
  getHeroicTrackById,
  SELECTION_MODE_CUSTOM,
  SELECTION_MODE_THEME,
} from './competitionMusicThemes.js';

/**
 * COMPETITION AUDIO MANAGER (Phase 2 — Host Only & Heroic Orchestral)
 *
 * Responsibilities:
 * - Orchestrates Competition V1 background music loops, heroic orchestral tracks, and Web Audio SFX
 * - Reuses the shared repository AudioContext from soundEffects.js (Zero 2nd context)
 * - Manages track registry, theme selection, custom track selection (lobby/question), volume scaling, mute/music/SFX toggles
 * - Hardened Preview lifecycle with guaranteed zero duplicate restores and fail-silent guards
 * - Handles autoplay unlocking on user gesture
 * - 100% fail-silent (audio errors NEVER throw, block, or degrade game state)
 * - Safe lifecycle cleanup (NEVER close the global shared AudioContext)
 */

export const BACKGROUND_MUSIC_AVAILABLE = true;

export const BACKGROUND_MUSIC_TRACKS = {
  lobby: '/audio/competition/lobby_loop.mp3',
  question_active: '/audio/competition/question_active_loop.mp3',
};

class CompetitionAudioManager {
  constructor() {
    this.isUnlocked = false;
    this.globalSoundEnabled = true;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.volume = 0.5; // Default safe volume (0.0 - 1.0)

    this.isGamePaused = false;
    this.isMusicAvailable = BACKGROUND_MUSIC_AVAILABLE;

    // Selection mode: 'theme' | 'custom'
    this.selectionMode = SELECTION_MODE_THEME;
    this.currentThemeId = DEFAULT_MUSIC_THEME;
    this.customLobbyTrackId = 'km_at_launch';
    this.customQuestionTrackId = 'sb_titan';

    this.currentTrack = null;
    this.activeAudio = null;

    // Hardened preview lifecycle state
    this.previewAudio = null;
    this.previewThemeId = null;
    this.previewTrackId = null;
    this.isPreviewActive = false;
    this.previewRestored = false;
    this.onPreviewEndCallback = null;

    this.audioElements = new Map(); // src -> HTMLAudioElement
    this.isMusicPaused = false;
    this.needsPlaybackRetry = false;
    this.retryListeners = new Set();
    this.playGeneration = 0; // Monotonic counter to invalidate superseded playback promises
  }

  setNeedsPlaybackRetry(val) {
    const nextVal = Boolean(val);
    if (this.needsPlaybackRetry !== nextVal) {
      this.needsPlaybackRetry = nextVal;
      this.notifyRetryListeners();
    }
  }

  addRetryListener(listener) {
    if (typeof listener === 'function') {
      this.retryListeners.add(listener);
    }
  }

  removeRetryListener(listener) {
    this.retryListeners.delete(listener);
  }

  notifyRetryListeners() {
    this.retryListeners.forEach((fn) => {
      try {
        fn(this.needsPlaybackRetry);
      } catch (_e) {}
    });
  }

  /**
   * Resolve source URL for requested trackKey based on selectionMode and currentThemeId / custom tracks
   * Strictly refuses unavailable themes (e.g. scorm_track).
   */
  getTrackSrc(trackKey) {
    if (!trackKey) return null;

    // In custom mode, resolve individual heroic tracks
    if (this.selectionMode === SELECTION_MODE_CUSTOM) {
      if (trackKey === 'lobby') {
        const track = getHeroicTrackById(this.customLobbyTrackId);
        return track ? track.src : '/audio/competition/heroic/at_launch.mp3';
      }
      if (trackKey === 'question_active') {
        const track = getHeroicTrackById(this.customQuestionTrackId);
        return track ? track.src : '/audio/competition/heroic/titan.mp3';
      }
      return BACKGROUND_MUSIC_TRACKS[trackKey] || null;
    }

    // In theme mode, check for 'none' or theme definition
    if (this.currentThemeId === 'none') return null;
    const theme = getThemeById(this.currentThemeId);
    if (!theme || theme.available === false) return null;
    if (trackKey === 'lobby') return theme.lobbyTrack;
    if (trackKey === 'question_active') return theme.questionTrack;
    return BACKGROUND_MUSIC_TRACKS[trackKey] || null;
  }

  /**
   * Set music selection mode ('theme' | 'custom')
   */
  setSelectionMode(mode) {
    const validMode = mode === SELECTION_MODE_CUSTOM ? SELECTION_MODE_CUSTOM : SELECTION_MODE_THEME;
    if (this.selectionMode === validMode) return;

    const oldSrc = this.currentTrack ? this.getTrackSrc(this.currentTrack) : null;
    this.selectionMode = validMode;
    const newSrc = this.currentTrack ? this.getTrackSrc(this.currentTrack) : null;

    if (this.currentTrack) {
      if (oldSrc === newSrc) {
        return;
      }

      this.stopPreview(false);
      this.stopCurrentAudioElement();

      if (this.selectionMode === SELECTION_MODE_THEME && this.currentThemeId === 'none') {
        this.needsPlaybackRetry = false;
        return;
      }
      if (this.isGamePaused || !this.globalSoundEnabled || !this.musicEnabled) {
        if (this.isGamePaused) this.isMusicPaused = true;
        return;
      }
      this.playMusic(this.currentTrack, true);
    }
  }

  getSelectionMode() {
    return this.selectionMode;
  }

  /**
   * Set custom tracks for lobby and question
   */
  setCustomTracks({ lobbyTrackId, questionTrackId }) {
    let affectsActivePlayback = false;

    if (lobbyTrackId && this.customLobbyTrackId !== lobbyTrackId) {
      this.customLobbyTrackId = lobbyTrackId;
      if (this.currentTrack === 'lobby') {
        affectsActivePlayback = true;
      }
    }
    if (questionTrackId && this.customQuestionTrackId !== questionTrackId) {
      this.customQuestionTrackId = questionTrackId;
      if (this.currentTrack === 'question_active') {
        affectsActivePlayback = true;
      }
    }

    if (affectsActivePlayback && this.selectionMode === SELECTION_MODE_CUSTOM && this.currentTrack) {
      this.stopPreview(false);
      this.stopCurrentAudioElement();
      if (!this.isGamePaused && this.globalSoundEnabled && this.musicEnabled) {
        this.playMusic(this.currentTrack, true);
      }
    }
  }

  /**
   * Set active background music theme
   * Strictly enforces selectable themes; unavailable themes (e.g. scorm_track) fall back to default.
   */
  setTheme(themeId) {
    const validId = isSelectableThemeId(themeId) ? themeId : DEFAULT_MUSIC_THEME;
    if (this.currentThemeId === validId && this.selectionMode === SELECTION_MODE_THEME) {
      return;
    }

    // Stop current playing audio and preview BEFORE switching theme ID
    this.stopPreview(false);
    if (this.currentTrack) {
      this.stopCurrentAudioElement();
    }

    this.currentThemeId = validId;
    this.selectionMode = SELECTION_MODE_THEME;

    if (this.currentTrack) {
      if (this.currentThemeId === 'none') {
        this.setNeedsPlaybackRetry(false);
        return;
      }

      // Guard: Paused state or disabled sound/music blocks theme-switch autoplay
      if (this.isGamePaused || !this.globalSoundEnabled || !this.musicEnabled) {
        if (this.isGamePaused) {
          this.isMusicPaused = true;
        }
        return;
      }

      // Restart active lifecycle track under the newly selected theme
      this.playMusic(this.currentTrack, true);
    }
  }

  getTheme() {
    return this.currentThemeId;
  }

  /**
   * Unlock audio playback upon user interaction
   * Safely resumes shared AudioContext and retries current background track if available
   */
  async unlock() {
    this.isUnlocked = true;
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
    } catch (_err) {
      // Fail silent
    }

    // Safely retry / resume current background track on user gesture unlock ONLY if music is available and not paused
    if (
      this.isMusicAvailable &&
      this.currentTrack &&
      this.globalSoundEnabled &&
      this.musicEnabled &&
      !this.isGamePaused &&
      !this.isMusicPaused &&
      (this.selectionMode === SELECTION_MODE_CUSTOM || this.currentThemeId !== 'none')
    ) {
      this.retryCurrentBackgroundTrack();
    }

    return this.isUnlocked;
  }

  /**
   * Safe execution of HTMLAudioElement.play() with generational tracking and AbortError discrimination
   */
  safePlayAudio(audio, trackKey, src) {
    const generation = ++this.playGeneration;
    audio.volume = this.volume;

    let playPromise;
    try {
      playPromise = audio.play();
    } catch (syncErr) {
      if (!this.isMusicPaused && !this.isGamePaused && this.currentTrack === trackKey) {
        this.setNeedsPlaybackRetry(true);
      }
      return;
    }

    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          // Stale Promise Guard: Only clear retry flag if this track and generation are still active
          if (this.currentTrack === trackKey && this.playGeneration === generation) {
            this.setNeedsPlaybackRetry(false);
          }
        })
        .catch((err) => {
          // 1. Stale Promise Guard: If currentTrack or generation changed, ignore superseded promise
          if (this.currentTrack !== trackKey || this.playGeneration !== generation) {
            return;
          }
          // 2. AbortError Guard: Intentional pause / track switch must not flag retry
          if (err && err.name === 'AbortError') {
            return;
          }
          // 3. Genuine playback rejection (e.g. NotAllowedError or media decode failure)
          if (!this.isMusicPaused && !this.isGamePaused) {
            this.setNeedsPlaybackRetry(true);
          }
        });
    } else {
      if (this.currentTrack === trackKey && this.playGeneration === generation) {
        this.setNeedsPlaybackRetry(false);
      }
    }
  }

  /**
   * Dedicated safe retry/resume method for background track after unlock gesture
   */
  retryCurrentBackgroundTrack() {
    if (
      !this.isMusicAvailable ||
      !this.currentTrack ||
      !this.globalSoundEnabled ||
      !this.musicEnabled ||
      this.isGamePaused ||
      this.isMusicPaused ||
      (this.selectionMode === SELECTION_MODE_THEME && this.currentThemeId === 'none')
    ) {
      return;
    }

    if (typeof Audio === 'undefined') {
      return;
    }

    const src = this.getTrackSrc(this.currentTrack);
    if (!src) return;

    try {
      let audio = this.audioElements.get(src);
      if (!audio) {
        audio = new Audio(src);
        audio.loop = true;
        audio.preload = 'auto';
        this.audioElements.set(src, audio);
      }
      this.activeAudio = audio;

      this.safePlayAudio(audio, this.currentTrack, src);
    } catch (_err) {
      if (!this.isMusicPaused && !this.isGamePaused) {
        this.setNeedsPlaybackRetry(true);
      }
    }
  }

  /**
   * Separate GAME/LIFECYCLE pause state from user preference state
   */
  setGamePaused(isPaused) {
    this.isGamePaused = Boolean(isPaused);
    if (this.isGamePaused) {
      this.stopPreview(false);
      this.pauseMusic();
    } else if (
      this.currentTrack &&
      this.globalSoundEnabled &&
      this.musicEnabled &&
      this.isMusicPaused &&
      (this.selectionMode === SELECTION_MODE_CUSTOM || this.currentThemeId !== 'none')
    ) {
      this.resumeMusic();
    }
  }

  /**
   * Sync with repository global sound preference
   */
  setGlobalSoundEnabled(enabled) {
    this.globalSoundEnabled = Boolean(enabled);
    if (!this.globalSoundEnabled) {
      this.stopPreview(false);
      this.pauseMusic();
    } else if (
      this.currentTrack &&
      this.musicEnabled &&
      !this.isGamePaused &&
      (this.isMusicPaused || this.needsPlaybackRetry) &&
      (this.selectionMode === SELECTION_MODE_CUSTOM || this.currentThemeId !== 'none')
    ) {
      this.resumeMusic();
    }
  }

  /**
   * Toggle background music
   */
  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (!this.musicEnabled) {
      this.stopPreview(false);
      this.pauseMusic();
    } else if (
      this.currentTrack &&
      this.globalSoundEnabled &&
      !this.isGamePaused &&
      (this.isMusicPaused || this.needsPlaybackRetry) &&
      (this.selectionMode === SELECTION_MODE_CUSTOM || this.currentThemeId !== 'none')
    ) {
      this.resumeMusic();
    }
  }

  /**
   * Toggle sound effects
   */
  setSfxEnabled(enabled) {
    this.sfxEnabled = Boolean(enabled);
  }

  /**
   * Set master volume (0.0 - 1.0)
   */
  setVolume(vol) {
    const clamped = Math.max(0, Math.min(1, typeof vol === 'number' ? vol : 0.5));
    this.volume = clamped;

    if (this.activeAudio) {
      try {
        this.activeAudio.volume = this.volume;
      } catch (_e) {}
    }
    if (this.previewAudio) {
      try {
        this.previewAudio.volume = this.volume;
      } catch (_e) {}
    }
  }

  /**
   * Play background music track (lobby | question_active)
   */
  playMusic(trackKey, force = false) {
    if (!trackKey || !BACKGROUND_MUSIC_TRACKS[trackKey]) {
      return;
    }

    if (!force && this.currentTrack === trackKey && !this.isMusicPaused && !this.needsPlaybackRetry) {
      return;
    }

    if (this.currentTrack && (force || this.currentTrack !== trackKey)) {
      this.stopCurrentAudioElement();
    }

    this.currentTrack = trackKey;

    if (this.isGamePaused) {
      this.isMusicPaused = true;
      this.setNeedsPlaybackRetry(false);
      return;
    }

    this.isMusicPaused = false;

    if (this.selectionMode === SELECTION_MODE_THEME && this.currentThemeId === 'none') {
      this.setNeedsPlaybackRetry(false);
      return;
    }

    if (!this.isMusicAvailable) {
      this.setNeedsPlaybackRetry(false);
      return;
    }

    this.setNeedsPlaybackRetry(false);

    if (!this.globalSoundEnabled || !this.musicEnabled) {
      this.setNeedsPlaybackRetry(false);
      return;
    }

    if (typeof Audio === 'undefined') {
      return;
    }

    const src = this.getTrackSrc(trackKey);
    if (!src) {
      this.setNeedsPlaybackRetry(false);
      return;
    }

    try {
      let audio = this.audioElements.get(src);
      if (!audio) {
        audio = new Audio(src);
        audio.loop = true;
        audio.preload = 'auto';
        this.audioElements.set(src, audio);
      }

      this.activeAudio = audio;
      this.safePlayAudio(audio, trackKey, src);
    } catch (_err) {
      if (!this.isMusicPaused && !this.isGamePaused) {
        this.setNeedsPlaybackRetry(true);
      }
    }
  }

  /**
   * Preview a theme's lobby track safely
   */
  previewTheme(themeId, onEnd) {
    if (this.isGamePaused) {
      return false;
    }
    if (!themeId || themeId === 'none' || !isValidThemeId(themeId)) {
      this.stopPreview(false);
      return false;
    }
    const theme = getThemeById(themeId);
    if (!theme || theme.available === false || !theme.lobbyTrack) {
      this.stopPreview(false);
      return false;
    }

    return this.previewTrackUrl(theme.lobbyTrack, themeId, onEnd, true);
  }

  /**
   * Preview an individual heroic track safely
   */
  previewTrack(trackId, onEnd) {
    if (this.isGamePaused) {
      return false;
    }
    const track = getHeroicTrackById(trackId);
    if (!track || !track.src) {
      this.stopPreview(false);
      return false;
    }
    return this.previewTrackUrl(track.src, trackId, onEnd, false);
  }

  /**
   * Internal shared implementation for previewing any track URL safely
   */
  previewTrackUrl(src, identifier, onEnd, isTheme = true) {
    this.stopPreview(false);

    if (this.activeAudio && !this.isMusicPaused) {
      try {
        this.activeAudio.pause();
      } catch (_e) {}
    }

    if (typeof Audio === 'undefined') {
      return false;
    }

    try {
      const audio = new Audio(src);
      audio.loop = false;
      audio.volume = this.volume;
      this.previewAudio = audio;
      if (isTheme) {
        this.previewThemeId = identifier;
        this.previewTrackId = null;
      } else {
        this.previewTrackId = identifier;
        this.previewThemeId = null;
      }
      this.isPreviewActive = true;
      this.previewRestored = false;
      this.onPreviewEndCallback = onEnd;

      const handleNaturalOrTimeoutEnd = () => {
        this.stopPreview(true);
      };

      audio.onended = handleNaturalOrTimeoutEnd;
      audio.ontimeupdate = () => {
        if (audio.currentTime >= 25) {
          handleNaturalOrTimeoutEnd();
        }
      };

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          this.stopPreview(true);
        });
      }
      return true;
    } catch (_err) {
      this.stopPreview(true);
      return false;
    }
  }

  /**
   * Stop active preview and restore background music exactly once if eligible
   */
  stopPreview(restore = true) {
    const wasActive = this.isPreviewActive;
    const oldAudio = this.previewAudio;
    const oldCallback = this.onPreviewEndCallback;

    if (oldAudio) {
      try {
        oldAudio.onended = null;
        oldAudio.ontimeupdate = null;
        oldAudio.pause();
        oldAudio.currentTime = 0;
      } catch (_e) {}
    }

    this.previewAudio = null;
    this.previewThemeId = null;
    this.previewTrackId = null;
    this.isPreviewActive = false;
    this.onPreviewEndCallback = null;

    if (typeof oldCallback === 'function') {
      try {
        oldCallback();
      } catch (_e) {}
    }

    if (wasActive && restore && !this.previewRestored) {
      this.previewRestored = true;
      if (
        this.currentTrack &&
        !this.isMusicPaused &&
        !this.isGamePaused &&
        this.globalSoundEnabled &&
        this.musicEnabled &&
        (this.selectionMode === SELECTION_MODE_CUSTOM || this.currentThemeId !== 'none')
      ) {
        this.resumeMusic();
      }
    }
  }

  /**
   * Pause active background music
   */
  pauseMusic() {
    this.isMusicPaused = true;
    this.needsPlaybackRetry = false;
    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
      } catch (_err) {}
    } else if (this.currentTrack) {
      const src = this.getTrackSrc(this.currentTrack);
      const audio = src && this.audioElements.get(src);
      if (audio) {
        try {
          audio.pause();
        } catch (_err) {}
      }
    }
  }

  /**
   * Resume active background music
   */
  resumeMusic() {
    if (!this.currentTrack || !this.globalSoundEnabled || !this.musicEnabled || this.isGamePaused) {
      return;
    }
    this.isMusicPaused = false;

    if (
      !this.isMusicAvailable ||
      (this.selectionMode === SELECTION_MODE_THEME && this.currentThemeId === 'none')
    ) {
      return;
    }

    const src = this.getTrackSrc(this.currentTrack);
    if (!src) {
      return;
    }

    let audio = this.audioElements.get(src);
    if (!audio && typeof Audio !== 'undefined') {
      audio = new Audio(src);
      audio.loop = true;
      audio.preload = 'auto';
      this.audioElements.set(src, audio);
    }

    if (audio) {
      this.activeAudio = audio;
      try {
        this.safePlayAudio(audio, this.currentTrack, src);
      } catch (_err) {
        if (!this.isMusicPaused && !this.isGamePaused) {
          this.setNeedsPlaybackRetry(true);
        }
      }
    }
  }

  /**
   * Stop current background music track and reset position
   */
  stopMusic() {
    this.stopPreview(false);
    this.stopCurrentAudioElement();
    this.currentTrack = null;
    this.isMusicPaused = false;
    this.setNeedsPlaybackRetry(false);
  }

  /**
   * Internal helper to stop active audio element
   */
  stopCurrentAudioElement() {
    this.playGeneration++; // Invalidate any pending play promises for the element being stopped
    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
        this.activeAudio.currentTime = 0;
      } catch (_err) {}
      this.activeAudio = null;
    }
    // Rigorously pause all tracked audio elements to guarantee zero concurrent audio playback
    this.audioElements.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_err) {}
    });
  }

  /**
   * Play Competition Web Audio SFX
   */
  playSfx(sfxType) {
    if (!this.globalSoundEnabled || !this.sfxEnabled) {
      return;
    }

    try {
      playSound(sfxType, true, this.volume);
    } catch (_err) {
      // Fail-silent
    }
  }

  /**
   * Stop all music and reset playback states
   */
  stopAll() {
    this.stopPreview(false);
    this.stopMusic();
    this.audioElements.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_e) {}
    });
    this.needsPlaybackRetry = false;
    this.isGamePaused = false;
  }

  /**
   * Full cleanup on Host unmount or session exit
   */
  cleanup() {
    this.stopAll();
  }
}

// Export singleton instance
export const competitionAudioManager = new CompetitionAudioManager();
