import { getAudioContext, playSound } from '../utils/soundEffects.js';
import {
  DEFAULT_MUSIC_THEME,
  getThemeById,
  isValidThemeId,
} from './competitionMusicThemes.js';

/**
 * COMPETITION AUDIO MANAGER (Phase 1 — Host Only)
 *
 * Responsibilities:
 * - Orchestrates Competition V1 background music loops and Web Audio SFX
 * - Reuses the shared repository AudioContext from soundEffects.js (Zero 2nd context)
 * - Manages track registry, theme selection, volume scaling, mute/music/SFX toggles
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

    this.currentThemeId = DEFAULT_MUSIC_THEME;
    this.currentTrack = null;
    this.activeAudio = null;
    this.previewAudio = null;
    this.previewThemeId = null;
    this.audioElements = new Map(); // src -> HTMLAudioElement
    this.isMusicPaused = false;
    this.needsPlaybackRetry = false;
  }

  /**
   * Resolve source URL for requested trackKey based on currentThemeId
   */
  getTrackSrc(trackKey) {
    if (!trackKey) return null;
    if (this.currentThemeId === 'none') return null;
    const theme = getThemeById(this.currentThemeId);
    if (!theme) return null;
    if (trackKey === 'lobby') return theme.lobbyTrack;
    if (trackKey === 'question_active') return theme.questionTrack;
    return BACKGROUND_MUSIC_TRACKS[trackKey] || null;
  }

  /**
   * Set active background music theme
   */
  setTheme(themeId) {
    const validId = isValidThemeId(themeId) ? themeId : DEFAULT_MUSIC_THEME;
    if (this.currentThemeId === validId) {
      return;
    }

    // Stop current playing audio and preview BEFORE switching theme ID
    this.stopPreview(false);
    if (this.currentTrack) {
      this.stopCurrentAudioElement();
    }

    this.currentThemeId = validId;

    if (this.currentTrack) {
      if (this.currentThemeId === 'none') {
        this.needsPlaybackRetry = false;
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
    if (this.isMusicAvailable && this.currentTrack && this.globalSoundEnabled && this.musicEnabled && !this.isGamePaused && !this.isMusicPaused && this.currentThemeId !== 'none') {
      this.retryCurrentBackgroundTrack();
    }

    return this.isUnlocked;
  }

  /**
   * Dedicated safe retry/resume method for background track after unlock gesture
   * Invariants:
   * - isMusicAvailable === true
   * - currentTrack exists
   * - currentThemeId !== 'none'
   * - globalSoundEnabled === true
   * - musicEnabled === true
   * - NEVER overrides intentional game pause (isGamePaused & isMusicPaused must be false)
   * - Reuses existing HTMLAudio element if created, otherwise creates safely
   */
  retryCurrentBackgroundTrack() {
    if (!this.isMusicAvailable || !this.currentTrack || !this.globalSoundEnabled || !this.musicEnabled || this.isGamePaused || this.isMusicPaused || this.currentThemeId === 'none') {
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

      audio.volume = this.volume;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            this.needsPlaybackRetry = false;
          })
          .catch((_err) => {
            if (!this.isMusicPaused && !this.isGamePaused) {
              this.needsPlaybackRetry = true;
            }
          });
      } else {
        this.needsPlaybackRetry = false;
      }
    } catch (_err) {
      if (!this.isMusicPaused && !this.isGamePaused) {
        this.needsPlaybackRetry = true;
      }
    }
  }

  /**
   * Separate GAME/LIFECYCLE pause state from user preference state
   * Authoritative Competition state transitions control this flag.
   */
  setGamePaused(isPaused) {
    this.isGamePaused = Boolean(isPaused);
    if (this.isGamePaused) {
      this.pauseMusic();
    } else if (this.currentTrack && this.globalSoundEnabled && this.musicEnabled && this.isMusicPaused && this.currentThemeId !== 'none') {
      this.resumeMusic();
    }
  }

  /**
   * Sync with repository global sound preference (sound_enabled from SoundContext)
   * MUST NEVER override active game pause.
   */
  setGlobalSoundEnabled(enabled) {
    this.globalSoundEnabled = Boolean(enabled);
    if (!this.globalSoundEnabled) {
      this.pauseMusic();
    } else if (this.currentTrack && this.musicEnabled && !this.isGamePaused && (this.isMusicPaused || this.needsPlaybackRetry) && this.currentThemeId !== 'none') {
      this.resumeMusic();
    }
  }

  /**
   * Toggle background music
   * MUST NEVER override active game pause.
   */
  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (!this.musicEnabled) {
      this.pauseMusic();
    } else if (this.currentTrack && this.globalSoundEnabled && !this.isGamePaused && (this.isMusicPaused || this.needsPlaybackRetry) && this.currentThemeId !== 'none') {
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

    // Update volume on currently active audio element
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
   * Guaranteed Invariants:
   * - If already playing the requested track: NO restart, NO duplicate playback
   * - If game is paused or sound/music disabled: records currentTrack but keeps audio paused
   * - If theme is 'none': records currentTrack but creates ZERO Audio object and ZERO network request
   * - If file is missing or play() rejected: fails completely silently
   */
  playMusic(trackKey, force = false) {
    if (!trackKey || !BACKGROUND_MUSIC_TRACKS[trackKey]) {
      return;
    }

    // Guard: Do not restart if already playing this track (unless retry needed or force reload)
    if (!force && this.currentTrack === trackKey && !this.isMusicPaused && !this.needsPlaybackRetry) {
      return;
    }

    // Stop existing different track before switching
    if (this.currentTrack && (force || this.currentTrack !== trackKey)) {
      this.stopCurrentAudioElement();
    }

    this.currentTrack = trackKey;

    // If game is currently paused, record current track but keep music paused
    if (this.isGamePaused) {
      this.isMusicPaused = true;
      this.needsPlaybackRetry = false;
      return;
    }

    this.isMusicPaused = false;

    // If theme is 'none', record logical lifecycle track but perform ZERO Audio creation or network attempt
    if (this.currentThemeId === 'none') {
      this.needsPlaybackRetry = false;
      return;
    }

    // If background music assets are not available, record logical track but perform ZERO Audio creation
    if (!this.isMusicAvailable) {
      this.needsPlaybackRetry = false;
      return;
    }

    this.needsPlaybackRetry = true;

    if (!this.globalSoundEnabled || !this.musicEnabled) {
      this.needsPlaybackRetry = false;
      return;
    }

    if (typeof Audio === 'undefined') {
      return;
    }

    const src = this.getTrackSrc(trackKey);
    if (!src) {
      this.needsPlaybackRetry = false;
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
      audio.volume = this.volume;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            this.needsPlaybackRetry = false;
          })
          .catch((_err) => {
            // Handled fail-silently: asset might not exist yet or autoplay blocked
            if (!this.isMusicPaused && !this.isGamePaused) {
              this.needsPlaybackRetry = true;
            }
          });
      } else {
        this.needsPlaybackRetry = false;
      }
    } catch (_err) {
      if (!this.isMusicPaused && !this.isGamePaused) {
        this.needsPlaybackRetry = true;
      }
    }
  }

  /**
   * Preview a theme's lobby track safely
   * Controlled duration, user gesture required, zero 2nd AudioContext, zero game interference.
   */
  previewTheme(themeId, onEnd) {
    if (this.isGamePaused || this.currentTrack === 'question_active') {
      return false;
    }
    if (!themeId || themeId === 'none') {
      this.stopPreview();
      return false;
    }
    const theme = getThemeById(themeId);
    if (!theme || !theme.lobbyTrack) {
      this.stopPreview();
      return false;
    }

    this.stopPreview(false);

    // If active lobby music is currently playing, pause it during preview
    if (this.activeAudio && !this.isMusicPaused) {
      try {
        this.activeAudio.pause();
      } catch (_e) {}
    }

    if (typeof Audio === 'undefined') {
      return false;
    }

    try {
      const audio = new Audio(theme.lobbyTrack);
      audio.loop = false;
      audio.volume = this.volume;
      this.previewAudio = audio;
      this.previewThemeId = themeId;

      const stopAndRestore = () => {
        this.stopPreview(true);
        if (typeof onEnd === 'function') onEnd();
      };

      audio.onended = stopAndRestore;
      audio.ontimeupdate = () => {
        if (audio.currentTime >= 15) {
          stopAndRestore();
        }
      };

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          stopAndRestore();
        });
      }
      return true;
    } catch (_err) {
      this.stopPreview(true);
      return false;
    }
  }

  /**
   * Stop active preview and restore background music if eligible
   */
  stopPreview(restore = true) {
    const wasPreviewing = Boolean(this.previewAudio);
    if (this.previewAudio) {
      try {
        this.previewAudio.pause();
        this.previewAudio.currentTime = 0;
        this.previewAudio.onended = null;
        this.previewAudio.ontimeupdate = null;
      } catch (_e) {}
      this.previewAudio = null;
    }
    this.previewThemeId = null;

    // Restore background music only if preview was actively running and restore is permitted
    if (wasPreviewing && restore && this.currentTrack && !this.isMusicPaused && !this.isGamePaused && this.globalSoundEnabled && this.musicEnabled && this.currentThemeId !== 'none') {
      this.resumeMusic();
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
   * Guarded against active game pause and unavailable assets
   */
  resumeMusic() {
    if (!this.currentTrack || !this.globalSoundEnabled || !this.musicEnabled || this.isGamePaused) {
      return;
    }
    this.isMusicPaused = false;

    if (!this.isMusicAvailable || this.currentThemeId === 'none') {
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
        audio.volume = this.volume;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise
            .then(() => {
              this.needsPlaybackRetry = false;
            })
            .catch(() => {
              if (!this.isMusicPaused && !this.isGamePaused) {
                this.needsPlaybackRetry = true;
              }
            });
        } else {
          this.needsPlaybackRetry = false;
        }
      } catch (_err) {
        if (!this.isMusicPaused && !this.isGamePaused) {
          this.needsPlaybackRetry = true;
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
    this.needsPlaybackRetry = false;
  }

  /**
   * Internal helper to stop active audio element
   */
  stopCurrentAudioElement() {
    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
        this.activeAudio.currentTime = 0;
      } catch (_err) {}
      this.activeAudio = null;
    }
    if (this.currentTrack) {
      const src = this.getTrackSrc(this.currentTrack);
      const audio = src && this.audioElements.get(src);
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (_err) {}
      }
    }
  }

  /**
   * Play Competition Web Audio SFX
   * Guaranteed Invariants:
   * - Respects globalSoundEnabled and sfxEnabled
   * - Uses master volume scaling
   * - Fails completely silently if blocked or AudioContext suspended
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
   * CRITICAL: NEVER close the global shared AudioContext!
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
