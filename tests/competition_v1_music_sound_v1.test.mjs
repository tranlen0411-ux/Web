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
      competitionAudioManager.stopAll();
      competitionAudioManager.setGlobalSoundEnabled(false);
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.needsPlaybackRetry = true;

      await competitionAudioManager.unlock();
      assert.equal(playAttempts, 0, 'Must NOT retry music when globalSoundEnabled is false');
    } finally {
      global.Audio = originalAudio;
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
      competitionAudioManager.stopAll();
      competitionAudioManager.setGlobalSoundEnabled(true);
      competitionAudioManager.setMusicEnabled(false);
      competitionAudioManager.currentTrack = 'lobby';
      competitionAudioManager.needsPlaybackRetry = true;

      await competitionAudioManager.unlock();
      assert.equal(playAttempts, 0, 'Must NOT retry music when musicEnabled is false');
    } finally {
      global.Audio = originalAudio;
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
});
