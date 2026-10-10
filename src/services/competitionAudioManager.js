import { getAudioContext, playSound } from '../utils/soundEffects.js';

/**
 * COMPETITION AUDIO MANAGER (Phase 1 — Host Only)
 *
 * Responsibilities:
 * - Orchestrates Competition V1 background music loops and Web Audio SFX
 * - Reuses the shared repository AudioContext from soundEffects.js (Zero 2nd context)
 * - Manages track registry, volume scaling, mute/music/SFX toggles
 * - Handles autoplay unlocking on user gesture
 * - 100% fail-silent (audio errors NEVER throw, block, or degrade game state)
 * - Safe lifecycle cleanup (NEVER close the global shared AudioContext)
 */

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

    this.currentTrack = null;
    this.audioElements = new Map(); // trackKey -> HTMLAudioElement
    this.isMusicPaused = false;
  }

  /**
   * Unlock audio playback upon user interaction
   * Safely resumes shared AudioContext and primes HTMLAudio capability
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
    return this.isUnlocked;
  }

  /**
   * Sync with repository global sound preference (sound_enabled from SoundContext)
   */
  setGlobalSoundEnabled(enabled) {
    this.globalSoundEnabled = Boolean(enabled);
    if (!this.globalSoundEnabled) {
      this.pauseMusic();
    } else if (this.currentTrack && this.musicEnabled && this.isMusicPaused) {
      this.resumeMusic();
    }
  }

  /**
   * Toggle background music
   */
  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (!this.musicEnabled) {
      this.pauseMusic();
    } else if (this.currentTrack && this.globalSoundEnabled && this.isMusicPaused) {
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
    if (this.currentTrack) {
      const audio = this.audioElements.get(this.currentTrack);
      if (audio) {
        try {
          audio.volume = this.volume;
        } catch (_e) {}
      }
    }
  }

  /**
   * Play background music track (lobby | question_active)
   * Guaranteed Invariants:
   * - If already playing the requested track: NO restart, NO duplicate playback
   * - If sound or music is disabled: records currentTrack but keeps audio paused
   * - If file is missing or play() rejected: fails completely silently
   */
  playMusic(trackKey) {
    if (!trackKey || !BACKGROUND_MUSIC_TRACKS[trackKey]) {
      return;
    }

    // Guard: Do not restart if already playing this track
    if (this.currentTrack === trackKey && !this.isMusicPaused) {
      return;
    }

    // Stop existing different track before switching
    if (this.currentTrack && this.currentTrack !== trackKey) {
      this.stopCurrentAudioElement();
    }

    this.currentTrack = trackKey;
    this.isMusicPaused = false;

    if (!this.globalSoundEnabled || !this.musicEnabled) {
      return;
    }

    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return;
    }

    try {
      let audio = this.audioElements.get(trackKey);
      if (!audio) {
        audio = new Audio(BACKGROUND_MUSIC_TRACKS[trackKey]);
        audio.loop = true;
        audio.preload = 'auto';
        this.audioElements.set(trackKey, audio);
      }

      audio.volume = this.volume;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((_err) => {
          // Handled fail-silently: asset might not exist yet or autoplay blocked
        });
      }
    } catch (_err) {
      // Fail-silent
    }
  }

  /**
   * Pause active background music
   */
  pauseMusic() {
    this.isMusicPaused = true;
    if (this.currentTrack) {
      const audio = this.audioElements.get(this.currentTrack);
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
    if (!this.currentTrack || !this.globalSoundEnabled || !this.musicEnabled) {
      return;
    }
    this.isMusicPaused = false;
    const audio = this.audioElements.get(this.currentTrack);
    if (audio) {
      try {
        audio.volume = this.volume;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch (_err) {}
    }
  }

  /**
   * Stop current background music track and reset position
   */
  stopMusic() {
    this.stopCurrentAudioElement();
    this.currentTrack = null;
    this.isMusicPaused = false;
  }

  /**
   * Internal helper to stop active audio element
   */
  stopCurrentAudioElement() {
    if (this.currentTrack) {
      const audio = this.audioElements.get(this.currentTrack);
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
    this.stopMusic();
    this.audioElements.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_e) {}
    });
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
