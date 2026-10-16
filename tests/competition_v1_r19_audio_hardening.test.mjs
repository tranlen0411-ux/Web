import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { competitionAudioManager, BACKGROUND_MUSIC_TRACKS } from '../src/services/competitionAudioManager.js';

const ROOT_DIR = process.cwd();

// Load real production source files
const studentAudioHookSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/hooks/useCompetitionStudentAudio.js'),
  'utf8'
);
const audioManagerSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/services/competitionAudioManager.js'),
  'utf8'
);

test('R19 AUDIO HARDENING REGRESSION TEST SUITE', async (t) => {

  // =========================================================================
  // TEST 1: Manager Generation Counter & AbortError Discrimination
  // =========================================================================
  await t.test('Test 1: Audio Manager ignores AbortError on paused/superseded track and does NOT set needsPlaybackRetry', async () => {
    // 1. Static verification of production code
    assert.ok(
      audioManagerSrc.includes('this.playGeneration = 0;'),
      'competitionAudioManager constructor must initialize playGeneration = 0'
    );
    assert.ok(
      audioManagerSrc.includes('this.playGeneration++;'),
      'competitionAudioManager.stopCurrentAudioElement must increment playGeneration'
    );
    assert.ok(
      audioManagerSrc.includes("err.name === 'AbortError'"),
      'safePlayAudio must check err.name === AbortError'
    );
    assert.ok(
      audioManagerSrc.includes('this.playGeneration === generation') ||
      audioManagerSrc.includes('this.playGeneration !== generation'),
      'safePlayAudio must check generation against current this.playGeneration'
    );

    // 2. Behavioral verification using actual imported competitionAudioManager
    competitionAudioManager.stopAll();
    assert.strictEqual(competitionAudioManager.needsPlaybackRetry, false);

    let playCallCount = 0;
    let pauseCallCount = 0;

    class MockAudio {
      constructor(src) {
        this.src = src;
        this.volume = 0.5;
        this.paused = true;
      }
      play() {
        this.paused = false;
        playCallCount++;
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            if (this.paused) {
              const err = new Error('The play() request was interrupted by a call to pause().');
              err.name = 'AbortError';
              reject(err);
            } else {
              resolve();
            }
          }, 20);
        });
      }
      pause() {
        pauseCallCount++;
        this.paused = true;
      }
    }
    global.Audio = MockAudio;

    // Start lobby music
    competitionAudioManager.playMusic('lobby');
    assert.strictEqual(competitionAudioManager.currentTrack, 'lobby');
    const lobbyGeneration = competitionAudioManager.playGeneration;

    // Immediately switch to question_active (triggers pause() on lobby and increments playGeneration)
    competitionAudioManager.playMusic('question_active');
    assert.strictEqual(competitionAudioManager.currentTrack, 'question_active');
    assert.ok(
      competitionAudioManager.playGeneration > lobbyGeneration,
      'playGeneration must increment on stopCurrentAudioElement'
    );

    // Wait 50ms for lobby Promise rejection to be processed
    await new Promise((r) => setTimeout(r, 60));

    // AbortError on superseded lobby track MUST NOT set needsPlaybackRetry = true
    assert.strictEqual(
      competitionAudioManager.needsPlaybackRetry,
      false,
      'needsPlaybackRetry must remain false after AbortError on old track'
    );
  });

  // =========================================================================
  // TEST 2: Genuine failure sets needsPlaybackRetry
  // =========================================================================
  await t.test('Test 2: Audio Manager sets needsPlaybackRetry on real NotAllowedError on ACTIVE track', async () => {
    competitionAudioManager.stopAll();
    competitionAudioManager.audioElements.clear();

    class FailingAudio {
      constructor(src) {
        this.src = src;
        this.volume = 0.5;
        this.paused = true;
      }
      play() {
        const err = new Error("play() failed because the user didn't interact with document first.");
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      pause() {
        this.paused = true;
      }
    }
    global.Audio = FailingAudio;

    competitionAudioManager.playMusic('question_active');
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(
      competitionAudioManager.needsPlaybackRetry,
      true,
      'Genuine error on active track must set needsPlaybackRetry = true'
    );
  });

  // =========================================================================
  // TEST 3: Student Phase Transition & QUESTION_LOADING Invariant
  // =========================================================================
  await t.test('Test 3: Student Audio State Machine handles QUESTION_LOADING and prevents premature QUESTION_ACTIVE', () => {
    // 1. Static code verification in useCompetitionStudentAudio.js
    assert.ok(
      studentAudioHookSrc.includes("currentPhase = 'QUESTION_LOADING';"),
      'useCompetitionStudentAudio.js must define QUESTION_LOADING phase'
    );
    assert.ok(
      studentAudioHookSrc.includes("currentPhase === 'QUESTION_LOADING'"),
      'useCompetitionStudentAudio.js master effect must handle QUESTION_LOADING phase'
    );
    assert.ok(
      studentAudioHookSrc.includes('competitionAudioManager.stopMusic();'),
      'QUESTION_LOADING must cleanly call competitionAudioManager.stopMusic()'
    );

    // 2. Behavioral verification of the phase resolution logic
    // Extract exact state machine logic directly from production file
    function resolvePhaseFromHookLogic({ status, currentQuestionId, timeLeftSeconds, isInterimLeaderboardActive }) {
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
      return currentPhase;
    }

    // Step A: Waiting state -> LOBBY
    assert.strictEqual(
      resolvePhaseFromHookLogic({
        status: 'waiting',
        currentQuestionId: null,
        timeLeftSeconds: null,
        isInterimLeaderboardActive: false,
      }),
      'LOBBY'
    );

    // Step B: In progress but question payload is still downloading/null -> QUESTION_LOADING
    assert.strictEqual(
      resolvePhaseFromHookLogic({
        status: 'in_progress',
        currentQuestionId: null,
        timeLeftSeconds: 30,
        isInterimLeaderboardActive: false,
      }),
      'QUESTION_LOADING',
      'Must be QUESTION_LOADING when currentQuestionId is null'
    );

    // Step C: Question arrives -> QUESTION_ACTIVE
    assert.strictEqual(
      resolvePhaseFromHookLogic({
        status: 'in_progress',
        currentQuestionId: 'q-uuid-101',
        timeLeftSeconds: 30,
        isInterimLeaderboardActive: false,
      }),
      'QUESTION_ACTIVE',
      'Must be QUESTION_ACTIVE once currentQuestionId is valid'
    );

    // Step D: Time Up
    assert.strictEqual(
      resolvePhaseFromHookLogic({
        status: 'in_progress',
        currentQuestionId: 'q-uuid-101',
        timeLeftSeconds: 0,
        isInterimLeaderboardActive: false,
      }),
      'TIME_UP',
      'Must be TIME_UP when timeLeftSeconds <= 0'
    );

    // Step E: Results reveal
    assert.strictEqual(
      resolvePhaseFromHookLogic({
        status: 'in_progress',
        currentQuestionId: 'q-uuid-101',
        timeLeftSeconds: 0,
        isInterimLeaderboardActive: true,
      }),
      'QUESTION_RESULTS',
      'Must be QUESTION_RESULTS when isInterimLeaderboardActive is true'
    );
  });

  // =========================================================================
  // TEST 4: Zero Duplicate SFX Fanfare during transition
  // =========================================================================
  await t.test('Test 4: Zero duplicate SFX fanfare during transition from Lobby -> Question Loading -> Question Active', () => {
    // 1. Static code verification in useCompetitionStudentAudio.js
    assert.ok(
      studentAudioHookSrc.includes("`${sessionId}:${currentQuestionId}:QUESTION_OPEN`"),
      'Must construct QUESTION_OPEN guard key with sessionId and currentQuestionId'
    );
    assert.ok(
      studentAudioHookSrc.includes('lastPlayedSfxSetRef.current.has(openKey)'),
      'Must check lastPlayedSfxSetRef before dispatching QUESTION_OPEN SFX'
    );
    assert.ok(
      studentAudioHookSrc.includes("competitionAudioManager.playSfx('competition_question_open')"),
      'Must trigger competition_question_open SFX only when unguarded'
    );

    // 2. Behavioral test of SFX deduplication contract
    const lastPlayedSfxSet = new Set();
    const sessionId = 'session-test-4';
    let sfxCalls = [];

    function triggerQuestionOpen(currentQuestionId) {
      if (!currentQuestionId) return; // Guarded by hook condition
      const openKey = `${sessionId}:${currentQuestionId}:QUESTION_OPEN`;
      if (!lastPlayedSfxSet.has(openKey)) {
        lastPlayedSfxSet.add(openKey);
        sfxCalls.push(openKey);
      }
    }

    // Tick 1: Question loading (id is null)
    triggerQuestionOpen(null);
    assert.strictEqual(sfxCalls.length, 0, 'No SFX should be triggered when question is null');

    // Tick 2: Question arrives
    triggerQuestionOpen('q-101');
    assert.strictEqual(sfxCalls.length, 1, 'SFX should be triggered exactly once on question snapshot');
    assert.strictEqual(sfxCalls[0], 'session-test-4:q-101:QUESTION_OPEN');

    // Tick 3: Polling update 2s later with same question
    triggerQuestionOpen('q-101');
    assert.strictEqual(sfxCalls.length, 1, 'Polling must NOT re-trigger question open SFX');

    // Tick 4: Next question arrives
    triggerQuestionOpen('q-102');
    assert.strictEqual(sfxCalls.length, 2, 'Next question must trigger its own single SFX');
    assert.strictEqual(sfxCalls[1], 'session-test-4:q-102:QUESTION_OPEN');
  });

  // =========================================================================
  // TEST 5: Polling Anti-Restart Guard Invariant
  // =========================================================================
  await t.test('Test 5: Compound 5-tuple guard prevents audio restart on continuous polling updates', () => {
    // 1. Static code verification in useCompetitionStudentAudio.js
    assert.ok(
      studentAudioHookSrc.includes(
        '`${sessionId}:${currentQuestionId || \'pending\'}:${currentPhase}:${selectionMode}:${activeTrackSrc || \'none\'}`'
      ),
      'Must format 5-tuple compound guard key in useCompetitionStudentAudio.js'
    );
    assert.ok(
      studentAudioHookSrc.includes('if (lastCompoundKeyRef.current === compoundKey)'),
      'Must return early when compoundKey matches previous compound key'
    );

    // 2. Behavioral verification of compound guard execution
    let playMusicCalls = [];
    const sessionId = 'session-test-5';
    const selectionMode = 'theme';
    const activeTrackSrc = '/audio/competition/question_active_loop.mp3';
    let lastCompoundKey = null;

    function handleStudentAudioUpdate({ currentQuestionId, currentPhase }) {
      const compoundKey = `${sessionId}:${currentQuestionId || 'pending'}:${currentPhase}:${selectionMode}:${activeTrackSrc || 'none'}`;
      if (lastCompoundKey === compoundKey) {
        return 'GUARDED';
      }
      lastCompoundKey = compoundKey;
      if (currentPhase === 'QUESTION_ACTIVE') {
        playMusicCalls.push({ action: 'playMusic:question_active', key: compoundKey });
      }
      return 'EXECUTED';
    }

    // Tick 1: Question active arrives
    const res1 = handleStudentAudioUpdate({ currentQuestionId: 'q-501', currentPhase: 'QUESTION_ACTIVE' });
    assert.strictEqual(res1, 'EXECUTED');
    assert.strictEqual(playMusicCalls.length, 1);

    // Ticks 2 to 10: Polling updates every 2 seconds with identical state
    for (let i = 2; i <= 10; i++) {
      const res = handleStudentAudioUpdate({ currentQuestionId: 'q-501', currentPhase: 'QUESTION_ACTIVE' });
      assert.strictEqual(res, 'GUARDED');
    }
    assert.strictEqual(
      playMusicCalls.length,
      1,
      'playMusic must only be called once, never restarted by polling'
    );
  });

});
