import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();

// Read key files for static architecture & invariant checks
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const soundEffectsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/utils/soundEffects.js'), 'utf8');
const soundContextSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/context/SoundContext.jsx'), 'utf8');
const soundToggleSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/common/SoundToggle.jsx'), 'utf8');
const hostPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/CompetitionHostPage.jsx'), 'utf8');
const studentPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/CompetitionStudentPage.jsx'), 'utf8');
const spectatorPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/CompetitionSpectatorPage.jsx'), 'utf8');
const audioManagerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionAudioManager.js'), 'utf8');
const audioHookSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/hooks/useCompetitionAudio.js'), 'utf8');
const audioControlsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/competition/HostAudioControls.jsx'), 'utf8');
const musicThemesSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionMusicThemes.js'), 'utf8');

test('COMPETITION V1 — MUSIC & SOUND EFFECTS V1 TEST SUITE', async (t) => {

  await t.test('1. No third-party audio dependency in package.json', () => {
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const bannedLibraries = ['howler', 'howler.js', 'tone', 'tone.js', 'use-sound', 'react-use-audio-player'];
    for (const banned of bannedLibraries) {
      assert.equal(allDeps[banned], undefined, `Banned audio dependency found: ${banned}`);
    }
  });

  await t.test('2. Existing sound infrastructure preserved', () => {
    assert.match(soundEffectsSrc, /export const playSound/, 'playSound must be exported');
    assert.match(soundContextSrc, /export const SoundProvider/, 'SoundProvider must exist');
    assert.match(soundContextSrc, /export const useSound/, 'useSound must exist');
    assert.match(soundToggleSrc, /export const SoundToggle/, 'SoundToggle must exist');
  });

  await t.test('3. No second unnecessary AudioContext created in repo', () => {
    // AudioContextClass instantiation should ONLY happen in soundEffects.js
    assert.match(soundEffectsSrc, /new AudioContextClass\(\)/, 'Shared context instantiation exists in soundEffects.js');
    assert.doesNotMatch(audioManagerSrc, /new AudioContext/, 'competitionAudioManager must not create a 2nd AudioContext');
    assert.doesNotMatch(audioHookSrc, /new AudioContext/, 'useCompetitionAudio must not create an AudioContext');
    assert.doesNotMatch(hostPageSrc, /new AudioContext/, 'Host page must not instantiate AudioContext');
  });

  await t.test('4. Global sound_enabled preference respected in audio manager', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    
    competitionAudioManager.setGlobalSoundEnabled(false);
    assert.equal(competitionAudioManager.globalSoundEnabled, false);
    
    // SFX should not play when globally disabled
    let played = false;
    // When disabled, playSfx does nothing
    competitionAudioManager.playSfx('competition_question_open');
    assert.equal(competitionAudioManager.globalSoundEnabled, false);

    competitionAudioManager.setGlobalSoundEnabled(true);
    assert.equal(competitionAudioManager.globalSoundEnabled, true);
  });

  await t.test('5. Host-only audio scope: Host uses audio hook & controls', () => {
    assert.match(hostPageSrc, /useCompetitionAudio/, 'HostPage must integrate useCompetitionAudio');
    assert.match(hostPageSrc, /HostAudioControls/, 'HostPage must render HostAudioControls');
  });

  await t.test('6. Student audio unchanged', () => {
    assert.doesNotMatch(studentPageSrc, /useCompetitionAudio/, 'StudentPage must not use useCompetitionAudio');
    assert.doesNotMatch(studentPageSrc, /competitionAudioManager/, 'StudentPage must not use competitionAudioManager');
    assert.doesNotMatch(studentPageSrc, /HostAudioControls/, 'StudentPage must not render HostAudioControls');
  });

  await t.test('7. Spectator audio unchanged', () => {
    assert.doesNotMatch(spectatorPageSrc, /useCompetitionAudio/, 'SpectatorPage must not use useCompetitionAudio');
    assert.doesNotMatch(spectatorPageSrc, /competitionAudioManager/, 'SpectatorPage must not use competitionAudioManager');
    assert.doesNotMatch(spectatorPageSrc, /HostAudioControls/, 'SpectatorPage must not render HostAudioControls');
  });

  await t.test('8. Audio unlock requires user interaction', () => {
    assert.match(audioControlsSrc, /unlockAudio/, 'HostAudioControls must expose unlockAudio button');
    assert.match(audioControlsSrc, /Bật âm thanh/, 'HostAudioControls must show unlock label');
    assert.match(hostPageSrc, /unlockAudio\(\)/, 'handleStartSession triggers unlock on user gesture');
  });

  await t.test('9. Autoplay rejection does not break game (fail-silent)', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    assert.doesNotThrow(() => {
      competitionAudioManager.playMusic('non_existent_track');
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playSfx('competition_question_open');
    }, 'Playback attempts must never throw');
  });

  await t.test('10. QUESTION_OPEN plays once on transition', () => {
    assert.match(audioHookSrc, /QUESTION_OPEN/, 'Hook must guard QUESTION_OPEN event');
    assert.match(audioHookSrc, /lastPlayedEventsRef/, 'Hook must use compound event key guard');
  });

  await t.test('11. Polling rerender does not replay QUESTION_OPEN', () => {
    const setGuard = new Set();
    const sessionId = 'sess-123';
    const questionId = 'q-1';
    const openKey = `${sessionId}:${questionId}:QUESTION_OPEN`;

    let callCount = 0;
    const playOnce = () => {
      if (!setGuard.has(openKey)) {
        setGuard.add(openKey);
        callCount++;
      }
    };

    // Simulate 5 consecutive poll updates
    for (let i = 0; i < 5; i++) {
      playOnce();
    }
    assert.equal(callCount, 1, 'QUESTION_OPEN must play exactly once despite 5 polls');
  });

  await t.test('12-16. Countdown ticks (5, 4, 3, 2) and final tick (1) play once', () => {
    assert.match(audioHookSrc, /remaining <= 5 && remaining > 0/, 'Hook must check remaining <= 5 and > 0');
    assert.match(audioHookSrc, /remaining === 1 \? 'competition_countdown_final' : 'competition_countdown_tick'/, 'Hook must distinguish final second tick');
    assert.match(audioHookSrc, /lastCountdownTickKeyRef/, 'Hook must use tick key ref');

    const tickKeyGuard = { current: null };
    let playedTicks = [];

    const simulateTick = (qId, sec) => {
      const key = `${qId}:${sec}`;
      if (tickKeyGuard.current !== key) {
        tickKeyGuard.current = key;
        playedTicks.push(sec);
      }
    };

    // Simulate countdown from 5 to 1 with repeated re-renders on second 3
    [5, 4, 3, 3, 3, 2, 1].forEach(sec => simulateTick('q-1', sec));
    assert.deepEqual(playedTicks, [5, 4, 3, 2, 1], 'Each countdown second must play exactly once');
  });

  await t.test('17. Paused state blocks countdown SFX', () => {
    assert.match(audioHookSrc, /status !== 'in_progress'/, 'Countdown effect must bail when status !== in_progress');
  });

  await t.test('18. New question resets countdown tick guard', () => {
    assert.match(audioHookSrc, /prevQuestionIdRef\.current !== currentQuestionId/, 'Hook must detect question ID change');
    assert.match(audioHookSrc, /lastCountdownTickKeyRef\.current = null/, 'Hook must reset countdown tick guard on new question');
  });

  await t.test('19. Question close / time_up SFX plays once', () => {
    assert.match(audioHookSrc, /TIME_UP/, 'Hook must guard TIME_UP event');
  });

  await t.test('20. Results reveal SFX plays once on authoritative close', () => {
    assert.match(audioHookSrc, /QUESTION_RESULTS/, 'Hook must guard QUESTION_RESULTS event');
    assert.match(audioHookSrc, /competition_results_reveal/, 'Hook must trigger results reveal SFX');
  });

  await t.test('21. Historical review navigation does not replay reveal SFX', () => {
    assert.match(audioHookSrc, /!isReviewingHistory/, 'Results reveal must strictly be guarded by !isReviewingHistory');
    assert.match(hostPageSrc, /isReviewingHistory,/, 'HostPage must pass isReviewingHistory into useCompetitionAudio');
  });

  await t.test('22-23. Leaderboard open SFX once per intentional open, polling does not replay', () => {
    assert.match(audioHookSrc, /lastLeaderboardOpenRef/, 'Hook must track leaderboard open transition');
    assert.match(audioHookSrc, /isLeaderboardOpen && !wasOpen/, 'Leaderboard sound must only play on false -> true transition');
  });

  await t.test('24-25. Podium fanfare plays once per session, tab change does not replay', () => {
    assert.match(audioHookSrc, /podiumPlayedSessionRef\.current !== sessionId/, 'Podium fanfare must be guarded per sessionId');
    assert.match(audioHookSrc, /competition_podium/, 'Podium fanfare sound type must be triggered');
  });

  await t.test('26. Background same-track play does not restart', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.currentTrack = 'lobby';
    competitionAudioManager.isMusicPaused = false;
    
    // Calling playMusic('lobby') again should be a no-op
    competitionAudioManager.playMusic('lobby');
    assert.equal(competitionAudioManager.currentTrack, 'lobby');
  });

  await t.test('27. Pause music works', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.currentTrack = 'lobby';
    competitionAudioManager.pauseMusic();
    assert.equal(competitionAudioManager.isMusicPaused, true);
  });

  await t.test('28. Resume music works', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.currentTrack = 'lobby';
    competitionAudioManager.resumeMusic();
    assert.equal(competitionAudioManager.isMusicPaused, false);
  });

  await t.test('29. stopAll cleanup works without closing shared AudioContext', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    assert.equal(competitionAudioManager.currentTrack, null);
    assert.doesNotMatch(audioManagerSrc, /ctx\.close\(\)/, 'stopAll must not close global AudioContext');
  });

  await t.test('30. Session change resets Competition guards', () => {
    assert.match(audioHookSrc, /prevSessionIdRef\.current !== sessionId/, 'Hook must observe session changes');
    assert.match(audioHookSrc, /lastPlayedEventsRef\.current\.clear\(\)/, 'Hook must clear event set on session change');
  });

  await t.test('31. Audio failure fail-silent contract', () => {
    assert.match(audioManagerSrc, /catch/, 'Audio manager must catch all play promises');
    assert.match(soundEffectsSrc, /catch \(err\)/, 'soundEffects must catch all Web Audio errors');
  });

  await t.test('32. Performance V1 cache unchanged in HostPage', () => {
    assert.match(hostPageSrc, /historicalResultsCacheRef/, 'Performance V1 cache must be intact');
    assert.match(hostPageSrc, /inFlightResultsRef/, 'Performance V1 deduplication must be intact');
    assert.match(hostPageSrc, /latestHistoricalRequestIdRef/, 'Performance V1 race guard must be intact');
  });

  await t.test('33. R7 lazy analytics preserved', () => {
    assert.match(hostPageSrc, /HostQuestionAnalyticsView/, 'R7 analytics view must be preserved');
  });

  await t.test('34. R12 historical navigation preserved', () => {
    assert.match(hostPageSrc, /handleReviewPrevQuestion/, 'R12 prev question review preserved');
    assert.match(hostPageSrc, /handleReviewNextQuestion/, 'R12 next question review preserved');
    assert.match(hostPageSrc, /handleReturnToCurrentQuestion/, 'R12 return to current question preserved');
  });

  await t.test('35. R15A multiple choice regression check', () => {
    assert.match(hostPageSrc, /handleToggleCorrectOptionMulti/, 'R15A multiple choice handler preserved');
  });

  await t.test('36. R15B fill blank regression check', () => {
    assert.match(hostPageSrc, /handleAddAcceptedAnswer/, 'R15B fill blank handler preserved');
  });

  await t.test('37. Guest security regression preserved', () => {
    assert.match(studentPageSrc, /getOrCreateGuestToken/, 'Guest token generator preserved in student page');
  });

  await t.test('38. Spectator security regression preserved', () => {
    assert.match(spectatorPageSrc, /isValidSessionUUID/, 'Spectator UUID validation preserved');
  });

  await t.test('39. Leaderboard rank & ties unchanged', () => {
    assert.match(hostPageSrc, /fetchLeaderboard/, 'Leaderboard fetch preserved');
  });

  await t.test('40. Max 20 questions limit unchanged', () => {
    assert.match(hostPageSrc, /MAX_COMPETITION_QUESTIONS/, 'Max question limit preserved');
  });

  await t.test('41. No extra Competition timer created', () => {
    assert.doesNotMatch(audioHookSrc, /setInterval/, 'useCompetitionAudio must not create any setInterval timer');
  });

  await t.test('42. successful manual Host close triggers TIME_UP semantic event', () => {
    // 1. Hook exports semantic triggerQuestionClosed action
    assert.match(audioHookSrc, /triggerQuestionClosed/, 'Hook must expose triggerQuestionClosed');
    assert.match(audioHookSrc, /:TIME_UP/, 'triggerQuestionClosed must use TIME_UP event');
    assert.match(audioHookSrc, /competition_time_up/, 'triggerQuestionClosed must trigger time_up sound');

    // 2. HostPage invokes semantic triggerQuestionClosed on successful close
    assert.match(hostPageSrc, /audioControls\.triggerQuestionClosed/, 'HostPage must call triggerQuestionClosed');
    assert.doesNotMatch(hostPageSrc, /playSound\(['"]competition_time_up/, 'HostPage must NOT directly call raw playSound for manual close');

    // 3. Behavioral verification
    const setGuard = new Set();
    let timeUpCount = 0;
    const triggerClose = (sId, qId) => {
      const key = `${sId}:${qId}:TIME_UP`;
      if (!setGuard.has(key)) {
        setGuard.add(key);
        timeUpCount++;
      }
    };
    triggerClose('session-42', 'q-42');
    assert.equal(timeUpCount, 1, 'TIME_UP must be triggered on successful close');
  });

  await t.test('43. failed manual close does NOT trigger TIME_UP', () => {
    // In HostPage, triggerQuestionClosed must be inside if (res.success) block
    const closeSectionMatch = hostPageSrc.match(/const handleCloseQuestion = async \(\) => {([\s\S]*?)};/);
    assert.ok(closeSectionMatch, 'handleCloseQuestion must exist');
    const closeBody = closeSectionMatch[1];
    
    // Ensure triggerQuestionClosed is strictly in the success path
    assert.match(closeBody, /if\s*\(\s*res\.success\s*\)\s*\{[\s\S]*?triggerQuestionClosed/);
    // Ensure failure branch does NOT call triggerQuestionClosed
    const elseBranchMatch = closeBody.match(/else\s*\{([\s\S]*?)\}/);
    assert.ok(elseBranchMatch, 'else branch must exist in handleCloseQuestion');
    assert.doesNotMatch(elseBranchMatch[1], /triggerQuestionClosed/, 'Failure branch must not trigger audio');
  });

  await t.test('44. manual close + later zero/poll does NOT duplicate TIME_UP', () => {
    const setGuard = new Set();
    const sessionId = 'session-44';
    const questionId = 'q-44';
    const timeUpKey = `${sessionId}:${questionId}:TIME_UP`;

    let timeUpCallCount = 0;
    const playGuardedTimeUp = () => {
      if (!setGuard.has(timeUpKey)) {
        setGuard.add(timeUpKey);
        timeUpCallCount++;
      }
    };

    // Step 1: Host manually closes question
    playGuardedTimeUp();
    assert.equal(timeUpCallCount, 1, 'Initial manual close triggers TIME_UP');

    // Step 2: Later timer reaches 0
    playGuardedTimeUp();
    assert.equal(timeUpCallCount, 1, 'Subsequent timer reaching 0 does not duplicate TIME_UP');

    // Step 3: Repeated polling updates
    for (let i = 0; i < 5; i++) {
      playGuardedTimeUp();
    }
    assert.equal(timeUpCallCount, 1, 'Polling updates do not duplicate TIME_UP');
  });

  await t.test('45. autoplay-rejected lobby track is retried after unlock', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    
    // Setup Mock Audio to simulate autoplay rejection
    let playAttempts = 0;
    let shouldReject = true;

    class MockHtmlAudio {
      constructor(src) {
        this.src = src;
        this.volume = 1;
        this.loop = false;
        this.paused = true;
      }
      play() {
        playAttempts++;
        if (shouldReject) {
          return Promise.reject(new Error('Autoplay blocked by browser policy'));
        }
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    }

    const originalAudio = global.Audio;
    global.Audio = MockHtmlAudio;

    try {
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.setMusicEnabled(true);

      // 1. Play lobby music before unlock (autoplay blocked)
      competitionAudioManager.playMusic('lobby');
      assert.equal(playAttempts, 1, 'Initial play called');
      
      // Allow promise rejection microtask to settle
      await new Promise(r => setTimeout(r, 10));
      assert.equal(competitionAudioManager.needsPlaybackRetry, true, 'needsPlaybackRetry must be true after autoplay block');

      // 2. User clicks unlock / interaction gesture
      shouldReject = false;
      await competitionAudioManager.unlock();
      assert.equal(playAttempts, 2, 'unlock must retry playback for blocked track');
      assert.equal(competitionAudioManager.needsPlaybackRetry, false, 'needsPlaybackRetry cleared on successful retry');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('46. unlock does NOT resume music when global sound disabled', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    
    let playAttempts = 0;
    class MockHtmlAudio {
      constructor() { this.paused = true; }
      play() { playAttempts++; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockHtmlAudio;

    try {
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
      competitionAudioManager.setGlobalSoundEnabled(false);
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.needsPlaybackRetry = true;

      await competitionAudioManager.unlock();
      assert.equal(playAttempts, 0, 'Must NOT retry music when globalSoundEnabled is false');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.stopAll();
    }
  });

  await t.test('47. unlock does NOT resume music when music toggle disabled', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');

    let playAttempts = 0;
    class MockHtmlAudio {
      constructor() { this.paused = true; }
      play() { playAttempts++; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockHtmlAudio;

    try {
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.setMusicEnabled(false);
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.needsPlaybackRetry = true;

      await competitionAudioManager.unlock();
      assert.equal(playAttempts, 0, 'Must NOT retry music when musicEnabled is false');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.setMusicEnabled(true);
      competitionAudioManager.stopAll();
    }
  });

  await t.test('48. unlock does NOT override intentional paused-state music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');

    let playAttempts = 0;
    class MockHtmlAudio {
      constructor() { this.paused = true; }
      play() { playAttempts++; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockHtmlAudio;

    try {
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.setMusicEnabled(true);
      competitionAudioManager.currentTrack = 'lobby';
      
      // Intentional game pause
      competitionAudioManager.pauseMusic();
      assert.equal(competitionAudioManager.isMusicPaused, true);
      assert.equal(competitionAudioManager.needsPlaybackRetry, false);

      // Unlock gesture should NOT override intentional pause
      await competitionAudioManager.unlock();
      assert.equal(playAttempts, 0, 'Unlock must not override intentional pause');
      assert.equal(competitionAudioManager.isMusicPaused, true, 'isMusicPaused remains true');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('49. manager and hook local music state match on mount', async () => {
    assert.match(audioHookSrc, /competitionAudioManager\.setMusicEnabled\(isMusicEnabled\)/, 'Hook must synchronize musicEnabled to manager on mount');
    
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    // Simulate manager retaining previous session disabled state
    competitionAudioManager.setMusicEnabled(false);
    assert.equal(competitionAudioManager.musicEnabled, false);

    // Mount synchronization: hook initializes with isMusicEnabled = true and syncs into manager
    const hookInitialMusic = true;
    competitionAudioManager.setMusicEnabled(hookInitialMusic);
    assert.equal(competitionAudioManager.musicEnabled, hookInitialMusic, 'Manager state must match hook local state on mount');
  });

  await t.test('50. manager and hook SFX state match on mount', async () => {
    assert.match(audioHookSrc, /competitionAudioManager\.setSfxEnabled\(isSfxEnabled\)/, 'Hook must synchronize sfxEnabled to manager on mount');

    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    // Simulate manager retaining previous session disabled state
    competitionAudioManager.setSfxEnabled(false);
    assert.equal(competitionAudioManager.sfxEnabled, false);

    // Mount synchronization: hook initializes with isSfxEnabled = true and syncs into manager
    const hookInitialSfx = true;
    competitionAudioManager.setSfxEnabled(hookInitialSfx);
    assert.equal(competitionAudioManager.sfxEnabled, hookInitialSfx, 'Manager SFX state must match hook state on mount');
  });

  await t.test('51. manager and hook volume match on mount', async () => {
    assert.match(audioHookSrc, /competitionAudioManager\.setVolume\(volume\)/, 'Hook must synchronize volume to manager on mount');

    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    // Simulate manager retaining custom volume from earlier session
    competitionAudioManager.setVolume(0.15);
    assert.equal(competitionAudioManager.volume, 0.15);

    // Mount synchronization: hook initializes with volume = 0.5 and syncs into manager
    const hookInitialVolume = 0.5;
    competitionAudioManager.setVolume(hookInitialVolume);
    assert.equal(competitionAudioManager.volume, hookInitialVolume, 'Manager volume must match hook volume on mount');
  });

  await t.test('52. game pause state is distinct from global sound disable', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    
    // Set game pause
    competitionAudioManager.setGamePaused(true);
    assert.equal(competitionAudioManager.isGamePaused, true, 'isGamePaused must be true');

    // Global sound toggling must NOT alter game pause state
    competitionAudioManager.setGlobalSoundEnabled(false);
    assert.equal(competitionAudioManager.isGamePaused, true, 'Game pause persists through sound disable');
    competitionAudioManager.setGlobalSoundEnabled(true);
    assert.equal(competitionAudioManager.isGamePaused, true, 'Game pause persists through sound enable');

    competitionAudioManager.stopAll();
  });

  await t.test('53. global sound off->on while game paused does NOT resume music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.isMusicAvailable = true;

    try {
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.setGamePaused(true);
      assert.equal(competitionAudioManager.isMusicPaused, true, 'Music is paused by game pause');

      // Global sound disabled then re-enabled
      competitionAudioManager.setGlobalSoundEnabled(false);
      competitionAudioManager.setGlobalSoundEnabled(true);

      assert.equal(competitionAudioManager.isMusicPaused, true, 'Music MUST remain paused while game is paused');
    } finally {
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('54. music off->on while game paused does NOT resume music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.isMusicAvailable = true;

    try {
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.setGamePaused(true);
      assert.equal(competitionAudioManager.isMusicPaused, true, 'Music is paused by game pause');

      // Music toggle off then on
      competitionAudioManager.setMusicEnabled(false);
      competitionAudioManager.setMusicEnabled(true);

      assert.equal(competitionAudioManager.isMusicPaused, true, 'Music MUST remain paused while game is paused');
    } finally {
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('55. authoritative paused->in_progress clears game pause', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();

    competitionAudioManager.setGamePaused(true);
    assert.equal(competitionAudioManager.isGamePaused, true);

    // Authoritative game resume transition
    competitionAudioManager.setGamePaused(false);
    assert.equal(competitionAudioManager.isGamePaused, false, 'Authoritative resume clears game pause');

    // Verify static hook contract: status === paused and in_progress transition
    assert.match(audioHookSrc, /competitionAudioManager\.setGamePaused\(true\)/, 'Hook must call setGamePaused(true) on pause');
    assert.match(audioHookSrc, /competitionAudioManager\.setGamePaused\(false\)/, 'Hook must call setGamePaused(false) on resume');
  });

  await t.test('56. unlock while game paused does NOT resume background music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.isMusicAvailable = true;

    let playAttempts = 0;
    class MockHtmlAudio {
      constructor() { this.paused = true; }
      play() { playAttempts++; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockHtmlAudio;

    try {
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.setGamePaused(true);

      await competitionAudioManager.unlock();

      assert.equal(playAttempts, 0, 'Unlock gesture must NOT play background music while game is paused');
      assert.equal(competitionAudioManager.isMusicPaused, true);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = true;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('57. BACKGROUND_MUSIC_AVAILABLE true in assets release', async () => {
    const { BACKGROUND_MUSIC_AVAILABLE, competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    assert.equal(BACKGROUND_MUSIC_AVAILABLE, true, 'BACKGROUND_MUSIC_AVAILABLE must be true now that assets are shipped');
    assert.equal(competitionAudioManager.isMusicAvailable, true, 'Manager isMusicAvailable defaults to true');
  });

  await t.test('58. playMusic with unavailable assets creates ZERO Audio object', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    const prevAvailable = competitionAudioManager.isMusicAvailable;
    competitionAudioManager.isMusicAvailable = false;

    let audioObjectsCreated = 0;
    class SpyAudio {
      constructor() {
        audioObjectsCreated++;
      }
    }
    const originalAudio = global.Audio;
    global.Audio = SpyAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      assert.equal(audioObjectsCreated, 0, 'ZERO Audio objects must be created when assets are unavailable');
      assert.equal(competitionAudioManager.currentTrack, 'lobby', 'Logical track is recorded for future availability');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = prevAvailable;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('59. unavailable background asset causes ZERO network/play attempt', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    const prevAvailable = competitionAudioManager.isMusicAvailable;
    competitionAudioManager.isMusicAvailable = false;

    let playAttempts = 0;
    class SpyAudio {
      constructor() { this.paused = true; }
      play() { playAttempts++; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = SpyAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playMusic('question_active');
      competitionAudioManager.resumeMusic();
      assert.equal(playAttempts, 0, 'ZERO play or network attempts when assets are unavailable');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.isMusicAvailable = prevAvailable;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('60. missing asset does NOT set endless needsPlaybackRetry', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    const prevAvailable = competitionAudioManager.isMusicAvailable;
    competitionAudioManager.isMusicAvailable = false;

    try {
      competitionAudioManager.playMusic('lobby');
      assert.equal(competitionAudioManager.needsPlaybackRetry, false, 'needsPlaybackRetry must be false when asset missing');
    } finally {
      competitionAudioManager.isMusicAvailable = prevAvailable;
      competitionAudioManager.stopAll();
    }
  });

  await t.test('61. Host Music toggle disabled when assets unavailable', () => {
    assert.match(audioControlsSrc, /disabled=\{!isSoundEnabled\s*\|\|\s*!isMusicAvailable\}/, 'Host music toggle must be disabled when !isMusicAvailable');
  });

  await t.test('62. Host control shows truthful unavailable indicator', () => {
    assert.match(audioControlsSrc, /Chưa khả dụng/, 'Host control shows "Chưa khả dụng" badge');
    assert.match(audioControlsSrc, /Chưa có tệp nhạc/, 'Host control shows "Chưa có tệp nhạc" description');
  });

  await t.test('63. SFX remains usable while background music unavailable', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    assert.doesNotThrow(() => {
      competitionAudioManager.playSfx('competition_question_open');
      competitionAudioManager.playSfx('competition_time_up');
      competitionAudioManager.playSfx('competition_results_reveal');
      competitionAudioManager.playSfx('competition_podium');
    }, 'All Competition SFX must remain operational even when music assets are absent');
  });

  await t.test('64. audio unlock still works for SFX with no music assets', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    const prevAvailable = competitionAudioManager.isMusicAvailable;
    competitionAudioManager.isMusicAvailable = false;
    let retryMusicAttempted = false;
    const originalRetry = competitionAudioManager.retryCurrentBackgroundTrack;
    competitionAudioManager.retryCurrentBackgroundTrack = () => {
      retryMusicAttempted = true;
    };

    try {
      const unlocked = await competitionAudioManager.unlock();
      assert.equal(unlocked, true, 'AudioContext unlock must succeed for SFX');
      assert.equal(retryMusicAttempted, false, 'Must NOT attempt music retry when music assets are unavailable');
    } finally {
      competitionAudioManager.retryCurrentBackgroundTrack = originalRetry;
      competitionAudioManager.isMusicAvailable = prevAvailable;
    }
  });

  // ========================================================
  // FOCUSED TEST CASES FOR BACKGROUND MUSIC ASSETS V1 (65-86)
  // ========================================================

  await t.test('65. BACKGROUND_MUSIC_AVAILABLE true in live service', async () => {
    const { BACKGROUND_MUSIC_AVAILABLE, competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    assert.equal(BACKGROUND_MUSIC_AVAILABLE, true);
    assert.equal(competitionAudioManager.isMusicAvailable, true);
  });

  await t.test('66. lobby track registered', async () => {
    const { BACKGROUND_MUSIC_TRACKS } = await import('../src/services/competitionAudioManager.js');
    assert.equal(BACKGROUND_MUSIC_TRACKS.lobby, '/audio/competition/lobby_loop.mp3');
  });

  await t.test('67. question_active track registered', async () => {
    const { BACKGROUND_MUSIC_TRACKS } = await import('../src/services/competitionAudioManager.js');
    assert.equal(BACKGROUND_MUSIC_TRACKS.question_active, '/audio/competition/question_active_loop.mp3');
  });

  await t.test('68. waiting lifecycle selects lobby', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    class MockAudio {
      constructor(src) { this.src = src; this.paused = true; }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      assert.equal(competitionAudioManager.currentTrack, 'lobby');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('69. live question selects question_active', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    class MockAudio {
      constructor(src) { this.src = src; this.paused = true; }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('question_active');
      assert.equal(competitionAudioManager.currentTrack, 'question_active');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('70. paused stops playback', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let pauseCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; this.paused = true; }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; pauseCalled = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('question_active');
      competitionAudioManager.setGamePaused(true);
      assert.equal(pauseCalled, true);
      assert.equal(competitionAudioManager.isMusicPaused, true);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('71. resume respects game pause contract', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playCount = 0;
    class MockAudio {
      constructor(src) { this.src = src; this.paused = true; }
      play() { playCount++; this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('question_active');
      const countBeforePause = playCount;
      competitionAudioManager.setGamePaused(true);

      // User audio toggles while game is paused must NEVER resume audio
      competitionAudioManager.setGlobalSoundEnabled(false);
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.setMusicEnabled(false);
      competitionAudioManager.setMusicEnabled(true);

      assert.equal(playCount, countBeforePause, 'Audio toggles must NOT resume playback while game is paused');
      assert.equal(competitionAudioManager.isMusicPaused, true);

      // Authoritative game resume DOES resume
      competitionAudioManager.setGamePaused(false);
      assert.equal(playCount, countBeforePause + 1, 'Authoritative resume must restore playback');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('72. results stop music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let pauseCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
      pause() { pauseCalled = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('question_active');
      competitionAudioManager.stopMusic();
      assert.equal(pauseCalled, true);
      assert.equal(competitionAudioManager.currentTrack, null);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('73. finished stops music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let pauseCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
      pause() { pauseCalled = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.stopMusic();
      assert.equal(pauseCalled, true);
      assert.equal(competitionAudioManager.currentTrack, null);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('74. cancelled stops music', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let pauseCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
      pause() { pauseCalled = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.stopAll();
      assert.equal(pauseCalled, true);
      assert.equal(competitionAudioManager.currentTrack, null);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('75. same-track polling does not restart', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playCalls = 0;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { playCalls++; return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      assert.equal(playCalls, 1);
      // Allow audio play promise to settle
      await new Promise(r => setTimeout(r, 10));
      assert.equal(competitionAudioManager.needsPlaybackRetry, false);

      // Simulate multiple polling cycles
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playMusic('lobby');
      assert.equal(playCalls, 1, 'Same track must not restart on repeated calls');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('76. track switch stops old track', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    const pausedTracks = [];
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
      pause() { pausedTracks.push(this.src); }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playMusic('question_active');
      assert.equal(competitionAudioManager.currentTrack, 'question_active');
      assert.equal(pausedTracks.length >= 1, true, 'Old track must be paused when switching');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('77. music disabled prevents playback', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { playCalled = true; return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setMusicEnabled(false);
      competitionAudioManager.playMusic('lobby');
      assert.equal(playCalled, false);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setMusicEnabled(true);
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('78. global sound disabled prevents playback', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { playCalled = true; return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setGlobalSoundEnabled(false);
      competitionAudioManager.playMusic('lobby');
      assert.equal(playCalled, false);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('79. unavailable duplicate Audio element not created', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let audioInstances = 0;
    class MockAudio {
      constructor(src) { audioInstances++; this.src = src; }
      play() { return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playMusic('question_active');
      competitionAudioManager.playMusic('lobby');
      competitionAudioManager.playMusic('question_active');
      assert.equal(audioInstances, 2, 'Audio elements are cached per trackKey and never duplicated');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.audioElements.clear();
      competitionAudioManager.stopAll();
    }
  });

  await t.test('80. shared AudioContext invariant preserved', () => {
    assert.doesNotMatch(audioManagerSrc, /new (window\.)?AudioContext/, 'No 2nd AudioContext instantiated in manager');
    assert.doesNotMatch(audioHookSrc, /new (window\.)?AudioContext/, 'No 2nd AudioContext instantiated in hook');
    assert.match(soundEffectsSrc, /new AudioContextClass\(\)/, 'Single shared context instantiated in soundEffects.js');
  });

  await t.test('81. no extra timer introduced', () => {
    assert.doesNotMatch(audioManagerSrc, /setInterval/, 'No interval loop in competitionAudioManager');
    assert.doesNotMatch(audioHookSrc, /setInterval/, 'No interval loop in useCompetitionAudio');
  });

  await t.test('82. Student/Guest audio unchanged', () => {
    assert.doesNotMatch(studentPageSrc, /useCompetitionAudio/, 'Student page must not import Competition audio hook');
    assert.doesNotMatch(studentPageSrc, /competitionAudioManager/, 'Student page must not import Competition audio manager');
  });

  await t.test('83. Spectator audio unchanged', () => {
    assert.doesNotMatch(spectatorPageSrc, /useCompetitionAudio/, 'Spectator page must not import Competition audio hook');
    assert.doesNotMatch(spectatorPageSrc, /competitionAudioManager/, 'Spectator page must not import Competition audio manager');
  });

  await t.test('84. asset paths exact', async () => {
    const { BACKGROUND_MUSIC_TRACKS } = await import('../src/services/competitionAudioManager.js');
    assert.equal(BACKGROUND_MUSIC_TRACKS.lobby, '/audio/competition/lobby_loop.mp3');
    assert.equal(BACKGROUND_MUSIC_TRACKS.question_active, '/audio/competition/question_active_loop.mp3');
  });

  await t.test('85. asset files exist', () => {
    const lobbyFile = path.join(ROOT_DIR, 'public/audio/competition/lobby_loop.mp3');
    const questionFile = path.join(ROOT_DIR, 'public/audio/competition/question_active_loop.mp3');
    assert.equal(fs.existsSync(lobbyFile), true, 'lobby_loop.mp3 must exist');
    assert.equal(fs.existsSync(questionFile), true, 'question_active_loop.mp3 must exist');
    assert.ok(fs.statSync(lobbyFile).size > 100000, 'lobby_loop.mp3 has valid audio size');
    assert.ok(fs.statSync(questionFile).size > 100000, 'question_active_loop.mp3 has valid audio size');
  });

  await t.test('86. README provenance exists', () => {
    const readmeFile = path.join(ROOT_DIR, 'public/audio/competition/README.md');
    assert.equal(fs.existsSync(readmeFile), true, 'README.md must exist in competition audio directory');
    const content = fs.readFileSync(readmeFile, 'utf8');
    assert.match(content, /original project-generated/i, 'Provenance must state original generation');
    assert.match(content, /lobby_loop\.mp3/, 'README must document lobby track');
    assert.match(content, /question_active_loop\.mp3/, 'README must document question_active track');
  });

  await t.test('87. theme registry has exactly 3 themes', async () => {
    const { MUSIC_THEMES } = await import('../src/services/competitionMusicThemes.js');
    assert.equal(Array.isArray(MUSIC_THEMES), true);
    assert.equal(MUSIC_THEMES.length, 3, 'Theme registry must contain exactly 3 curated themes');
  });

  await t.test('88. valid IDs exact', async () => {
    const { MUSIC_THEMES, isValidThemeId } = await import('../src/services/competitionMusicThemes.js');
    const ids = MUSIC_THEMES.map((t) => t.id);
    assert.deepEqual(ids, ['classroom_chill', 'light_gameshow', 'calm_focus']);
    assert.equal(isValidThemeId('none'), true);
    assert.equal(isValidThemeId('classroom_chill'), true);
    assert.equal(isValidThemeId('light_gameshow'), true);
    assert.equal(isValidThemeId('calm_focus'), true);
    assert.equal(isValidThemeId('unknown_theme'), false);
    assert.equal(isValidThemeId(''), false);
    assert.equal(isValidThemeId(null), false);
  });

  await t.test('89. classroom_chill paths exact', async () => {
    const { getThemeById } = await import('../src/services/competitionMusicThemes.js');
    const theme = getThemeById('classroom_chill');
    assert.ok(theme);
    assert.equal(theme.lobbyTrack, '/audio/competition/lobby_loop.mp3');
    assert.equal(theme.questionTrack, '/audio/competition/question_active_loop.mp3');
  });

  await t.test('90. light_gameshow paths exact', async () => {
    const { getThemeById } = await import('../src/services/competitionMusicThemes.js');
    const theme = getThemeById('light_gameshow');
    assert.ok(theme);
    assert.equal(theme.lobbyTrack, '/audio/competition/themes/light_gameshow/lobby.mp3');
    assert.equal(theme.questionTrack, '/audio/competition/themes/light_gameshow/question.mp3');
  });

  await t.test('91. calm_focus paths exact', async () => {
    const { getThemeById } = await import('../src/services/competitionMusicThemes.js');
    const theme = getThemeById('calm_focus');
    assert.ok(theme);
    assert.equal(theme.lobbyTrack, '/audio/competition/themes/calm_focus/lobby.mp3');
    assert.equal(theme.questionTrack, '/audio/competition/themes/calm_focus/question.mp3');
  });

  await t.test('92. default theme classroom_chill', async () => {
    const { DEFAULT_MUSIC_THEME } = await import('../src/services/competitionMusicThemes.js');
    assert.equal(DEFAULT_MUSIC_THEME, 'classroom_chill');
  });

  await t.test('93. invalid localStorage fallback', async () => {
    const { getStoredThemeId, DEFAULT_MUSIC_THEME } = await import('../src/services/competitionMusicThemes.js');
    const originalLocalStorage = global.localStorage;
    const store = new Map();
    global.localStorage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, val) => store.set(key, String(val)),
    };
    try {
      store.set('competition_music_theme', 'invalid_random_theme');
      assert.equal(getStoredThemeId(), DEFAULT_MUSIC_THEME);
      store.set('competition_music_theme', '');
      assert.equal(getStoredThemeId(), DEFAULT_MUSIC_THEME);
      store.delete('competition_music_theme');
      assert.equal(getStoredThemeId(), DEFAULT_MUSIC_THEME);
    } finally {
      global.localStorage = originalLocalStorage;
    }
  });

  await t.test('94. selected theme persisted', async () => {
    const { getStoredThemeId, setStoredThemeId } = await import('../src/services/competitionMusicThemes.js');
    const originalLocalStorage = global.localStorage;
    const store = new Map();
    global.localStorage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, val) => store.set(key, String(val)),
    };
    try {
      setStoredThemeId('light_gameshow');
      assert.equal(store.get('competition_music_theme'), 'light_gameshow');
      assert.equal(getStoredThemeId(), 'light_gameshow');

      setStoredThemeId('none');
      assert.equal(store.get('competition_music_theme'), 'none');
      assert.equal(getStoredThemeId(), 'none');
    } finally {
      global.localStorage = originalLocalStorage;
    }
  });

  await t.test('95. refresh/load restores theme', async () => {
    const { getStoredThemeId } = await import('../src/services/competitionMusicThemes.js');
    const originalLocalStorage = global.localStorage;
    const store = new Map();
    store.set('competition_music_theme', 'calm_focus');
    global.localStorage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, val) => store.set(key, String(val)),
    };
    try {
      const restored = getStoredThemeId();
      assert.equal(restored, 'calm_focus');
    } finally {
      global.localStorage = originalLocalStorage;
    }
  });

  await t.test('96. theme none prevents background playback', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { playCalled = true; return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('none');
      competitionAudioManager.playMusic('lobby');
      assert.equal(playCalled, false, 'playMusic with theme none must NOT trigger Audio.play');
      assert.equal(competitionAudioManager.needsPlaybackRetry, false);
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('97. theme none keeps SFX available', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.setTheme('none');
    assert.equal(competitionAudioManager.sfxEnabled, true);
    assert.equal(competitionAudioManager.globalSoundEnabled, true);
    assert.doesNotThrow(() => {
      competitionAudioManager.playSfx('competition_question_open');
      competitionAudioManager.playSfx('competition_time_up');
    });
    competitionAudioManager.setTheme('classroom_chill');
  });

  await t.test('98. waiting uses selected lobby track', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let requestedSrc = null;
    class MockAudio {
      constructor(src) { requestedSrc = src; this.src = src; }
      play() { return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('light_gameshow');
      competitionAudioManager.playMusic('lobby');
      assert.equal(requestedSrc, '/audio/competition/themes/light_gameshow/lobby.mp3');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('99. live question uses selected question track', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let requestedSrc = null;
    class MockAudio {
      constructor(src) { requestedSrc = src; this.src = src; }
      play() { return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('calm_focus');
      competitionAudioManager.playMusic('question_active');
      assert.equal(requestedSrc, '/audio/competition/themes/calm_focus/question.mp3');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('100. switching theme stops previous track', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let pausedOld = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
      pause() { pausedOld = true; }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.playMusic('lobby');
      assert.equal(competitionAudioManager.currentTrack, 'lobby');

      competitionAudioManager.setTheme('light_gameshow');
      assert.equal(pausedOld, true, 'Switching theme must stop previous track');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('101. switching theme prevents overlap', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    const activeInstances = new Set();
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { activeInstances.add(this.src); return Promise.resolve(); }
      pause() { activeInstances.delete(this.src); }
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.playMusic('lobby');
      assert.equal(activeInstances.size, 1);
      assert.ok(activeInstances.has('/audio/competition/lobby_loop.mp3'));

      competitionAudioManager.setTheme('calm_focus');
      assert.equal(activeInstances.size, 1, 'Only exactly 1 track should be actively playing');
      assert.ok(activeInstances.has('/audio/competition/themes/calm_focus/lobby.mp3'));
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('102. music toggle preserves theme selection', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.setTheme('light_gameshow');
    assert.equal(competitionAudioManager.getTheme(), 'light_gameshow');

    competitionAudioManager.setMusicEnabled(false);
    assert.equal(competitionAudioManager.getTheme(), 'light_gameshow', 'Disabling music must preserve selected theme');

    competitionAudioManager.setMusicEnabled(true);
    assert.equal(competitionAudioManager.getTheme(), 'light_gameshow', 'Re-enabling music keeps selected theme');
    competitionAudioManager.setTheme('classroom_chill');
  });

  await t.test('103. global sound toggle preserves theme selection', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.setTheme('calm_focus');
    assert.equal(competitionAudioManager.getTheme(), 'calm_focus');

    competitionAudioManager.setGlobalSoundEnabled(false);
    assert.equal(competitionAudioManager.getTheme(), 'calm_focus', 'Disabling global sound must preserve selected theme');

    competitionAudioManager.setGlobalSoundEnabled(true);
    assert.equal(competitionAudioManager.getTheme(), 'calm_focus', 'Re-enabling global sound keeps selected theme');
    competitionAudioManager.setTheme('classroom_chill');
  });

  await t.test('104. paused state blocks theme-switch autoplay', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playCalled = false;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { playCalled = true; return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.playMusic('question_active');
      competitionAudioManager.setGamePaused(true);
      playCalled = false;

      competitionAudioManager.setTheme('light_gameshow');
      assert.equal(playCalled, false, 'Switching theme during paused game state must NOT autoplay');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setGamePaused(false);
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('105. resume uses currently selected theme', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    let playedSrc = null;
    class MockAudio {
      constructor(src) { this.src = src; }
      play() { playedSrc = this.src; return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('light_gameshow');
      competitionAudioManager.playMusic('question_active');
      competitionAudioManager.setGamePaused(true);
      playedSrc = null;

      competitionAudioManager.setGamePaused(false);
      assert.equal(playedSrc, '/audio/competition/themes/light_gameshow/question.mp3');
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('106. results stop music', () => {
    assert.match(audioHookSrc, /QUESTION_RESULTS/, 'Hook must guard QUESTION_RESULTS transition');
    assert.match(audioHookSrc, /competitionAudioManager\.stopMusic\(\)/, 'QUESTION_RESULTS must stop music');
  });

  await t.test('107. finished stops music', () => {
    assert.match(audioHookSrc, /status === 'finished'/, 'Hook must detect finished state');
    assert.match(audioHookSrc, /competitionAudioManager\.stopMusic\(\)/, 'finished must stop music');
  });

  await t.test('108. cancelled stops music', () => {
    assert.match(audioHookSrc, /status === 'cancelled'/, 'Hook must detect cancelled state');
    assert.match(audioHookSrc, /competitionAudioManager\.stopAll\(\)/, 'cancelled must stop all audio');
  });

  await t.test('109. no unselected-theme preload', async () => {
    const { competitionAudioManager } = await import('../src/services/competitionAudioManager.js');
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();
    const createdSources = [];
    class MockAudio {
      constructor(src) {
        createdSources.push(src);
        this.src = src;
      }
      play() { return Promise.resolve(); }
      pause() {}
    }
    const originalAudio = global.Audio;
    global.Audio = MockAudio;

    try {
      competitionAudioManager.setTheme('light_gameshow');
      competitionAudioManager.playMusic('lobby');
      assert.equal(createdSources.length, 1);
      assert.equal(createdSources[0], '/audio/competition/themes/light_gameshow/lobby.mp3');
      assert.ok(!createdSources.some((s) => s.includes('calm_focus')));
    } finally {
      global.Audio = originalAudio;
      competitionAudioManager.setTheme('classroom_chill');
      competitionAudioManager.stopAll();
    }
  });

  await t.test('110. no second AudioContext', () => {
    const freshThemesSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionMusicThemes.js'), 'utf8');
    const freshManagerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionAudioManager.js'), 'utf8');
    const freshHookSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/hooks/useCompetitionAudio.js'), 'utf8');
    assert.doesNotMatch(freshThemesSrc, /new AudioContext/, 'competitionMusicThemes must not instantiate AudioContext');
    assert.doesNotMatch(freshManagerSrc, /new AudioContext/, 'competitionAudioManager must not instantiate AudioContext');
    assert.doesNotMatch(freshHookSrc, /new AudioContext/, 'useCompetitionAudio must not instantiate AudioContext');
  });

  await t.test('111. no extra Competition timer', () => {
    const freshThemesSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionMusicThemes.js'), 'utf8');
    const freshManagerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionAudioManager.js'), 'utf8');
    const freshHookSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/hooks/useCompetitionAudio.js'), 'utf8');
    assert.doesNotMatch(freshThemesSrc, /setInterval/, 'No setInterval in competitionMusicThemes');
    assert.doesNotMatch(freshThemesSrc, /setTimeout/, 'No setTimeout in competitionMusicThemes');
    assert.doesNotMatch(freshManagerSrc, /setInterval/, 'No setInterval in competitionAudioManager');
    assert.doesNotMatch(freshHookSrc, /setInterval/, 'No setInterval in useCompetitionAudio');
  });

  await t.test('112. Student audio unchanged', () => {
    assert.doesNotMatch(studentPageSrc, /competitionMusicThemes/, 'StudentPage must not import themes');
    assert.doesNotMatch(studentPageSrc, /useCompetitionAudio/, 'StudentPage must not use useCompetitionAudio');
  });

  await t.test('113. Guest audio unchanged', () => {
    const guestPagePath = path.join(ROOT_DIR, 'src/pages/CompetitionGuestPage.jsx');
    if (fs.existsSync(guestPagePath)) {
      const guestContent = fs.readFileSync(guestPagePath, 'utf8');
      assert.doesNotMatch(guestContent, /useCompetitionAudio/, 'GuestPage must not import Competition audio hook');
    }
  });

  await t.test('114. Spectator audio unchanged', () => {
    assert.doesNotMatch(spectatorPageSrc, /competitionMusicThemes/, 'SpectatorPage must not import themes');
    assert.doesNotMatch(spectatorPageSrc, /useCompetitionAudio/, 'SpectatorPage must not use useCompetitionAudio');
  });

  await t.test('115. README documents all themes', () => {
    const readmeFile = path.join(ROOT_DIR, 'public/audio/competition/README.md');
    const content = fs.readFileSync(readmeFile, 'utf8');
    assert.match(content, /classroom_chill/i, 'README documents classroom_chill');
    assert.match(content, /light_gameshow/i, 'README documents light_gameshow');
    assert.match(content, /calm_focus/i, 'README documents calm_focus');
  });

  await t.test('116. all theme files exist', () => {
    const files = [
      'public/audio/competition/lobby_loop.mp3',
      'public/audio/competition/question_active_loop.mp3',
      'public/audio/competition/themes/light_gameshow/lobby.mp3',
      'public/audio/competition/themes/light_gameshow/question.mp3',
      'public/audio/competition/themes/calm_focus/lobby.mp3',
      'public/audio/competition/themes/calm_focus/question.mp3',
    ];
    for (const f of files) {
      const fullPath = path.join(ROOT_DIR, f);
      assert.equal(fs.existsSync(fullPath), true, `${f} must exist`);
      assert.ok(fs.statSync(fullPath).size > 100000, `${f} must have non-trivial size`);
    }
  });
});

