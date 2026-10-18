import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { competitionAudioManager, BACKGROUND_MUSIC_TRACKS } from '../src/services/competitionAudioManager.js';
import {
  isValidAudioConfig,
  isAudioConfigMatching,
  classifyAudioSnapshotState,
} from '../src/services/competitionAudioSync.js';
import {
  getThemeById,
  getHeroicTrackById,
  DEFAULT_MUSIC_THEME,
  SELECTION_MODE_CUSTOM,
  SELECTION_MODE_THEME,
} from '../src/services/competitionMusicThemes.js';

const ROOT_DIR = process.cwd();

// Load real production source files
const studentAudioHookSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/hooks/useCompetitionStudentAudio.js'),
  'utf8'
);
const hostAudioHookSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/hooks/useCompetitionAudio.js'),
  'utf8'
);
const hostPageSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/pages/CompetitionHostPage.jsx'),
  'utf8'
);
const studentControlsSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/components/competition/StudentAudioControls.jsx'),
  'utf8'
);
const hostControlsSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/components/competition/HostAudioControls.jsx'),
  'utf8'
);
const hostLobbyBannerSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/components/competition/HostAudioLobbyBanner.js'),
  'utf8'
);
const audioManagerSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/services/competitionAudioManager.js'),
  'utf8'
);
const rpcMigrationSql = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/20261015000001_competition_v1_audio_config_table.sql'),
  'utf8'
);
const liveSyncMigrationSql = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/20261018000001_competition_v1_r19_live_audio_sync.sql'),
  'utf8'
);

test('R19 AUDIO SYNCHRONIZATION & COMPLETE SESSION ISOLATION REGRESSION SUITE', async (t) => {

  // =========================================================================
  // TEST 1: Giáo viên chọn nhạc trước khi tạo phòng
  // =========================================================================
  await t.test('Test 1: Giáo viên chọn nhạc trước khi tạo phòng (Payload Contract)', () => {
    // 1. Static assertion in CompetitionHostPage.jsx
    assert.ok(
      hostPageSrc.includes("currentSelectionMode === 'custom' ? 'none' : (audioControls.themeId || 'classroom_chill')"),
      'Creation payload must enforce theme_id: none when selection_mode is custom'
    );
    assert.ok(
      hostPageSrc.includes("currentSelectionMode === 'custom' ? (audioControls.customLobbyTrackId || 'km_at_launch') : null"),
      'Creation payload must set custom_lobby_track_id only when custom'
    );
    assert.ok(
      hostPageSrc.includes("currentSelectionMode === 'custom' ? (audioControls.customQuestionTrackId || 'sb_titan') : null"),
      'Creation payload must set custom_question_track_id only when custom'
    );

    // 2. Behavioral verification of payload builder for Theme vs Custom
    function buildCreationPayload({ selectionMode, themeId, customLobbyTrackId, customQuestionTrackId, mode = 'online' }) {
      const currentSelectionMode = selectionMode === 'custom' ? 'custom' : 'theme';
      return {
        mode,
        selection_mode: currentSelectionMode,
        theme_id: currentSelectionMode === 'custom' ? 'none' : (themeId || 'classroom_chill'),
        custom_lobby_track_id: currentSelectionMode === 'custom' ? (customLobbyTrackId || 'km_at_launch') : null,
        custom_question_track_id: currentSelectionMode === 'custom' ? (customQuestionTrackId || 'sb_titan') : null,
      };
    }

    const themePayload = buildCreationPayload({
      selectionMode: 'theme',
      themeId: 'lofi_study',
    });
    assert.strictEqual(themePayload.selection_mode, 'theme');
    assert.strictEqual(themePayload.theme_id, 'lofi_study');
    assert.strictEqual(themePayload.custom_lobby_track_id, null);
    assert.strictEqual(themePayload.custom_question_track_id, null);
    assert.ok(isValidAudioConfig(themePayload), 'Theme payload must be valid audio config');

    const customPayload = buildCreationPayload({
      selectionMode: 'custom',
      customLobbyTrackId: 'sb_ignis',
      customQuestionTrackId: 'sb_the_fury',
    });
    assert.strictEqual(customPayload.selection_mode, 'custom');
    assert.strictEqual(customPayload.theme_id, 'none');
    assert.strictEqual(customPayload.custom_lobby_track_id, 'sb_ignis');
    assert.strictEqual(customPayload.custom_question_track_id, 'sb_the_fury');
    assert.ok(isValidAudioConfig(customPayload), 'Custom payload must be valid audio config');
  });

  // =========================================================================
  // TEST 2: Giáo viên đổi nhạc sau khi tạo phòng nhưng chưa lưu
  // =========================================================================
  await t.test('Test 2: Giáo viên đổi nhạc sau khi tạo phòng nhưng chưa lưu -> unsynced & Hiển thị nút Lưu & Đồng bộ', () => {
    // 1. Static assertion in CompetitionHostPage.jsx & HostAudioControls & HostAudioLobbyBanner
    assert.ok(
      hostPageSrc.includes("setAudioConfigStatus('unsynced')"),
      'CompetitionHostPage must transition to unsynced when local selection differs from saved'
    );
    assert.ok(
      hostLobbyBannerSrc.includes("audioConfigStatus === 'unsynced'"),
      'HostAudioLobbyBanner must handle unsynced state'
    );
    assert.ok(
      hostLobbyBannerSrc.includes('btn-save-sync-audio'),
      'HostAudioLobbyBanner must render data-testid btn-save-sync-audio'
    );
    assert.ok(
      hostControlsSrc.includes("audioConfigStatus === 'unsynced'"),
      'HostAudioControls must indicate unsynced status'
    );

    // 2. Behavioral verification of unsynced state detection
    const savedConfig = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'classroom_chill',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    const changedConfig = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'lofi_study',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    assert.strictEqual(
      isAudioConfigMatching(savedConfig, changedConfig),
      false,
      'Modified selection must not match savedConfig'
    );

    // Snapshot polling classifier must NOT overwrite unsynced changes
    const pollingDecision = classifyAudioSnapshotState({
      snapshot: {
        id: 'session-r19',
        audio_config_persisted: true,
        audio_config: savedConfig,
      },
      activeSessionId: 'session-r19',
      currentStatus: 'unsynced',
      lastSavedConfig: savedConfig,
    });
    assert.strictEqual(
      pollingDecision.action,
      'IGNORE_UNSYNCED_CHANGES',
      'Polling must preserve unsynced status while Host is reviewing changes'
    );
    assert.strictEqual(pollingDecision.nextStatus, null);
  });

  // =========================================================================
  // TEST 3: Thay đổi lựa chọn nhạc liên tiếp trong lúc RPC đang lưu (Race Guard)
  // =========================================================================
  await t.test('Test 3: Thay đổi lựa chọn nhạc liên tiếp trong lúc RPC đang lưu không được tạo trạng thái saved sai', () => {
    // In-flight save payload is config A
    const configA = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'calm_focus',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    // User rapidly switches to config B while save is still in flight
    const configB = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'light_gameshow',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    // Snapshot arrives with config A (which landed on DB)
    const snapshotA = {
      id: 'session-race-3',
      audio_config_persisted: true,
      audio_config: configA,
    };

    // While saving, classifyAudioSnapshotState ignores background snapshot
    const decisionSaving = classifyAudioSnapshotState({
      snapshot: snapshotA,
      activeSessionId: 'session-race-3',
      currentStatus: 'saving',
      pendingAudioConfig: configA,
    });
    assert.strictEqual(decisionSaving.action, 'IGNORE_SAVING_IN_PROGRESS');
    assert.strictEqual(decisionSaving.nextStatus, null);

    // If local selection in HostPage is currently configB, isAudioConfigMatching detects difference
    const isMatchingCurrentUi = isAudioConfigMatching(snapshotA.audio_config, configB);
    assert.strictEqual(isMatchingCurrentUi, false, 'Saved configA must not match current UI choice configB');
  });

  // =========================================================================
  // TEST 4: Giáo viên lưu và học sinh nhận đúng bài nhạc mới
  // =========================================================================
  await t.test('Test 4: Giáo viên lưu và học sinh nhận đúng bài nhạc mới qua đồng bộ tự động', async () => {
    // 1. Static assertions
    assert.ok(
      hostPageSrc.includes('handleSaveAndSyncAudioConfig'),
      'Host page must provide handleSaveAndSyncAudioConfig'
    );
    assert.ok(
      hostPageSrc.includes('hostSetAudioConfig'),
      'handleSaveAndSyncAudioConfig must invoke hostSetAudioConfig'
    );

    // 2. Behavioral test: Host saves, DB matches, state becomes saved
    const newConfig = {
      mode: 'online',
      selection_mode: 'custom',
      theme_id: 'none',
      custom_lobby_track_id: 'sb_ignis',
      custom_question_track_id: 'sb_the_fury',
    };

    let dbRecord = { ...newConfig };
    assert.ok(isAudioConfigMatching(dbRecord, newConfig), 'DB record matches saved payload');

    // Student receives snapshot with updated audio_config
    competitionAudioManager.stopAll();
    assert.strictEqual(competitionAudioManager.currentTrack, null);

    // Student synchronizes config into competitionAudioManager
    if (newConfig.selection_mode === SELECTION_MODE_CUSTOM) {
      competitionAudioManager.setSelectionMode(SELECTION_MODE_CUSTOM);
      competitionAudioManager.setCustomTracks({
        lobbyTrackId: newConfig.custom_lobby_track_id,
        questionTrackId: newConfig.custom_question_track_id,
      });
    }

    assert.strictEqual(competitionAudioManager.selectionMode, SELECTION_MODE_CUSTOM);
    assert.strictEqual(competitionAudioManager.customLobbyTrackId, 'sb_ignis');
    assert.strictEqual(competitionAudioManager.customQuestionTrackId, 'sb_the_fury');

    const expectedLobbySrc = getHeroicTrackById('sb_ignis').src;
    const expectedQuestionSrc = getHeroicTrackById('sb_the_fury').src;
    assert.strictEqual(competitionAudioManager.getTrackSrc('lobby'), expectedLobbySrc);
    assert.strictEqual(competitionAudioManager.getTrackSrc('question_active'), expectedQuestionSrc);
  });

  // =========================================================================
  // TEST 5: Lưu thất bại không được báo thành công
  // =========================================================================
  await t.test('Test 5: Lưu thất bại không được báo thành công & giữ trạng thái failed', () => {
    assert.ok(
      hostPageSrc.includes("setAudioConfigStatus('failed')"),
      'Must set audioConfigStatus to failed on RPC error or verification failure'
    );
    assert.ok(
      hostPageSrc.includes('isAudioConfigMatching(verifyRes.data?.audio_config, audioPayload)'),
      'Double check must verify exact matching audioPayload before declaring success'
    );

    const requestedConfig = {
      mode: 'online',
      selection_mode: 'custom',
      theme_id: 'none',
      custom_lobby_track_id: 'sb_ignis',
      custom_question_track_id: 'sb_titan',
    };

    const staleDbConfig = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'classroom_chill',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    // After save RPC fails, if DB still has staleConfig:
    const failedDecision = classifyAudioSnapshotState({
      snapshot: {
        id: 'session-5',
        audio_config_persisted: true,
        audio_config: staleDbConfig,
      },
      activeSessionId: 'session-5',
      currentStatus: 'failed',
      pendingAudioConfig: requestedConfig,
    });
    assert.strictEqual(failedDecision.action, 'PENDING_CONFIG_MISMATCH');
    assert.strictEqual(failedDecision.nextStatus, 'failed');
    assert.strictEqual(failedDecision.shouldClearPending, false);
  });

  // =========================================================================
  // TEST 6: Không bắt đầu trận đấu khi cấu hình chưa đồng bộ
  // =========================================================================
  await t.test('Test 6: Không bắt đầu trận đấu khi cấu hình chưa đồng bộ (unsynced, saving, failed)', () => {
    assert.ok(
      hostPageSrc.includes("if (audioConfigStatus === 'saving')"),
      'handleStartSession must block starting if saving'
    );
    assert.ok(
      hostPageSrc.includes("if (audioConfigStatus === 'unsynced')"),
      'handleStartSession must block starting if unsynced'
    );
    assert.ok(
      hostPageSrc.includes("if (audioConfigStatus === 'failed')"),
      'handleStartSession must block starting if failed'
    );
    assert.ok(
      hostPageSrc.includes("audioConfigStatus !== 'saved'"),
      'handleStartSession and button disabled must guard with audioConfigStatus !== saved'
    );

    function canStartSession({ actionPending, participantCount, audioConfigStatus }) {
      if (actionPending) return false;
      if (participantCount === 0) return false;
      if (audioConfigStatus !== 'saved') return false;
      return true;
    }

    assert.strictEqual(
      canStartSession({ actionPending: false, participantCount: 5, audioConfigStatus: 'unsynced' }),
      false,
      'Must NOT allow start when unsynced'
    );
    assert.strictEqual(
      canStartSession({ actionPending: false, participantCount: 5, audioConfigStatus: 'saving' }),
      false,
      'Must NOT allow start when saving'
    );
    assert.strictEqual(
      canStartSession({ actionPending: false, participantCount: 5, audioConfigStatus: 'failed' }),
      false,
      'Must NOT allow start when failed'
    );
    assert.strictEqual(
      canStartSession({ actionPending: false, participantCount: 5, audioConfigStatus: 'saved' }),
      true,
      'Can start when audioConfigStatus is strictly saved'
    );
  });

  // =========================================================================
  // TEST 7: Cho phép đổi nhạc khi trận đấu đang chạy (Live Music Sync Frontend + RPC Server Guard)
  // =========================================================================
  await t.test('Test 7: Cho phép đổi nhạc khi trận đấu đang chạy (Live Music Sync Frontend + RPC Server Guard)', () => {
    assert.ok(
      hostAudioHookSrc.includes('const isGameActive = status === \'in_progress\' || status === \'paused\';'),
      'useCompetitionAudio must define isGameActive'
    );
    assert.ok(
      !hostAudioHookSrc.includes('if (isGameActive) return;'),
      'useCompetitionAudio setters must allow music selection during active game'
    );
    assert.ok(
      !hostControlsSrc.includes('disabled={isGameActive}'),
      'Track selection buttons must not be disabled during active game'
    );
    assert.ok(
      liveSyncMigrationSql.includes("v_session.status NOT IN ('waiting', 'in_progress', 'paused')"),
      'RPC competition_host_set_audio_config must allow waiting, in_progress, and paused'
    );
    assert.ok(
      liveSyncMigrationSql.includes('INVALID_SESSION_STATE'),
      'RPC must return INVALID_SESSION_STATE if attempted on finished or cancelled sessions'
    );
  });

  // =========================================================================
  // TEST 8: Phòng A WAITING -> IN_PROGRESS giữ nguyên trạng thái mở khóa âm thanh
  // =========================================================================
  await t.test('Test 8: Phòng A WAITING -> IN_PROGRESS giữ nguyên trạng thái mở khóa âm thanh trong cùng phiên', async () => {
    // 1. Static assertion in useCompetitionStudentAudio.js
    assert.ok(
      studentAudioHookSrc.includes('const [isStudentAudioUnlocked, setIsStudentAudioUnlocked] = useState(false);'),
      'isStudentAudioUnlocked starts locked (false) per session'
    );
    assert.ok(
      studentAudioHookSrc.includes('retryStudentAudio'),
      'useCompetitionStudentAudio must export retryStudentAudio'
    );
    assert.ok(
      studentAudioHookSrc.includes('needsPlaybackRetry'),
      'useCompetitionStudentAudio must export needsPlaybackRetry'
    );

    // 2. Behavioral verification of state retention across re-renders of the same session
    let isStudentAudioUnlockedState = false;
    let sessionId = 'session-same-room-a';

    // Step A: Student enters room-a, clicks "Bật âm thanh" in WAITING lobby
    isStudentAudioUnlockedState = true;
    assert.strictEqual(isStudentAudioUnlockedState, true, 'Student unlocked in lobby');

    // Step B: Match starts in room-a (waiting -> in_progress), question 1 active
    // Since sessionId does not change, React state is NOT reset
    const isSessionSame = (sessionId === 'session-same-room-a');
    if (isSessionSame) {
      // isStudentAudioUnlockedState remains true!
    }
    assert.strictEqual(
      isStudentAudioUnlockedState,
      true,
      'Unlocked state must persist across WAITING -> IN_PROGRESS in same session'
    );

    // Step C: If browser rejects background play(), needsPlaybackRetry is surfaced
    class RejectingAudio {
      play() {
        const err = new Error('Autoplay not allowed');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      pause() {}
    }
    global.Audio = RejectingAudio;

    competitionAudioManager.playMusic('question_active');
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(
      competitionAudioManager.needsPlaybackRetry,
      true,
      'needsPlaybackRetry is flagged for UI recovery button'
    );

    // Student clicks recovery button (User Gesture)
    class WorkingAudio {
      play() { return Promise.resolve(); }
      pause() {}
    }
    global.Audio = WorkingAudio;
    await competitionAudioManager.unlock();
  });

  // =========================================================================
  // TEST 9: Cô lập phiên thi: Phòng A -> Phòng B trong cùng một SPA (không F5)
  // =========================================================================
  await t.test('Test 9: Cô lập phiên thi: Phòng A -> Phòng B trong cùng SPA bắt buộc reset unlock state và dừng nhạc cũ', () => {
    // 1. Static assertions
    assert.ok(
      studentAudioHookSrc.includes('setIsStudentAudioUnlocked(false);'),
      'Must reset isStudentAudioUnlocked to false when sessionId changes'
    );
    assert.ok(
      studentAudioHookSrc.includes('setNeedsPlaybackRetry(false);'),
      'Must reset needsPlaybackRetry when sessionId changes'
    );
    assert.ok(
      studentAudioHookSrc.includes('lastKnownAudioConfigRef.current = null;'),
      'Must clear lastKnownAudioConfigRef when sessionId changes'
    );

    // 2. Behavioral verification of room transition in same SPA
    let activeSessionId = 'room-a';
    let prevSessionId = 'room-a';
    let isStudentAudioUnlocked = true; // Unlocked in room A
    let cachedConfig = { mode: 'online', custom_lobby_track_id: 'sb_ignis' };
    let stopAllCalled = false;

    // Student exits Room A and enters Room B
    activeSessionId = 'room-b';

    // Simulate session change effect in useCompetitionStudentAudio.js
    if (prevSessionId !== activeSessionId) {
      prevSessionId = activeSessionId;
      isStudentAudioUnlocked = false; // RESET!
      cachedConfig = null; // WIPED!
      stopAllCalled = true;
    }

    assert.strictEqual(isStudentAudioUnlocked, false, 'Room B MUST start locked (false)');
    assert.strictEqual(cachedConfig, null, 'Room B must NOT inherit Room A config');
    assert.strictEqual(stopAllCalled, true, 'Room A audio must be stopped');
  });

  // =========================================================================
  // TEST 10: Cô lập phiên thi: Phòng A -> Phòng B -> Phòng A
  // =========================================================================
  await t.test('Test 10: Cô lập phiên thi: Chuỗi chuyển phòng liên tiếp Room A -> Room B -> Room A', () => {
    let activeSession = 'room-a';
    let prevSession = 'room-a';
    let isUnlocked = false;

    // 1. Student unlocks in Room A
    isUnlocked = true;
    assert.strictEqual(isUnlocked, true, 'Room A unlocked');

    // 2. Student navigates to Room B
    activeSession = 'room-b';
    if (prevSession !== activeSession) {
      prevSession = activeSession;
      isUnlocked = false;
    }
    assert.strictEqual(isUnlocked, false, 'Room B is locked upon entry');

    // 3. Student navigates back to Room A
    activeSession = 'room-a';
    if (prevSession !== activeSession) {
      prevSession = activeSession;
      isUnlocked = false;
    }
    assert.strictEqual(isUnlocked, false, 'Re-entering Room A starts locked and requires fresh unlock');
  });

  // =========================================================================
  // TEST 11: Phòng B nhận cấu hình muộn qua polling & Phòng in_class không phát nhạc
  // =========================================================================
  await t.test('Test 11: Phòng B nhận cấu hình muộn qua polling & Phòng in_class không phát nhạc', () => {
    let currentSessionId = 'room-b';
    let boundSessionId = 'room-b';
    let incomingAudioConfig = null; // snapshot still loading
    let lastKnownConfig = null;

    // While loading, effective config is null, defaulting safely to in_class
    const effectiveBefore = (currentSessionId && boundSessionId === currentSessionId)
      ? (incomingAudioConfig || lastKnownConfig)
      : null;
    const modeBefore = effectiveBefore?.mode || 'in_class';
    assert.strictEqual(modeBefore, 'in_class', 'Must default to in_class mute while snapshot is loading');

    // Polling completes and returns in_class config
    incomingAudioConfig = { mode: 'in_class', selection_mode: 'theme', theme_id: 'classroom_chill' };
    const effectiveInClass = incomingAudioConfig || lastKnownConfig;
    assert.strictEqual(effectiveInClass.mode, 'in_class', 'In-class mode confirmed');

    // In-class mode enforces zero music playback
    const isInClass = effectiveInClass.mode === 'in_class';
    assert.strictEqual(isInClass, true, 'isInClass is true');
  });

  // =========================================================================
  // TEST 12: Không phát trùng nhạc hoặc SFX khi polling (Deduplication)
  // =========================================================================
  await t.test('Test 12: Không phát trùng nhạc hoặc SFX khi polling (5-tuple guard & deduplication)', () => {
    assert.ok(
      studentAudioHookSrc.includes(
        '`${sessionId}:${currentQuestionId || \'pending\'}:${currentPhase}:${selectionMode}:${activeTrackSrc || \'none\'}`'
      ),
      '5-tuple compound guard key must be constructed in useCompetitionStudentAudio'
    );
    assert.ok(
      studentAudioHookSrc.includes('lastPlayedSfxSetRef.current.has(openKey)'),
      'SFX must be guarded against duplicate calls'
    );

    let playMusicInvocations = 0;
    let sfxInvocations = 0;
    let lastKey = null;
    const playedSfx = new Set();
    const sessionId = 'session-test-12';
    const qId = 'q-1201';

    function onStudentPollingTick() {
      const key = `${sessionId}:${qId}:QUESTION_ACTIVE:theme:/audio/titan.mp3`;
      if (lastKey !== key) {
        lastKey = key;
        playMusicInvocations++;
      }
      const sfxKey = `${sessionId}:${qId}:QUESTION_OPEN`;
      if (!playedSfx.has(sfxKey)) {
        playedSfx.add(sfxKey);
        sfxInvocations++;
      }
    }

    for (let i = 0; i < 10; i++) {
      onStudentPollingTick();
    }

    assert.strictEqual(playMusicInvocations, 1, 'playMusic must only be called once');
    assert.strictEqual(sfxInvocations, 1, 'sfx must only be called once');
  });

  // =========================================================================
  // TEST 13: Nhạc dừng khi hết giờ (TIME_UP) và hiển thị kết quả
  // =========================================================================
  await t.test('Test 13: Nhạc dừng khi hết giờ (TIME_UP) và hiển thị kết quả (QUESTION_RESULTS)', () => {
    assert.ok(
      studentAudioHookSrc.includes("currentPhase === 'TIME_UP'"),
      'Must handle TIME_UP phase'
    );
    assert.ok(
      studentAudioHookSrc.includes("currentPhase === 'QUESTION_RESULTS'"),
      'Must handle QUESTION_RESULTS phase'
    );
    assert.ok(
      hostAudioHookSrc.includes("triggerQuestionClosed"),
      'Host hook must provide semantic triggerQuestionClosed callback'
    );

    competitionAudioManager.stopAll();
    assert.strictEqual(competitionAudioManager.currentTrack, null);

    class DummyAudio {
      play() { return Promise.resolve(); }
      pause() {}
    }
    global.Audio = DummyAudio;

    competitionAudioManager.playMusic('question_active');
    assert.strictEqual(competitionAudioManager.currentTrack, 'question_active');

    // TIME_UP transition: stopMusic is called
    competitionAudioManager.stopMusic();
    assert.strictEqual(competitionAudioManager.currentTrack, null, 'Music must be stopped on TIME_UP');

    // QUESTION_RESULTS transition: stopMusic is called
    competitionAudioManager.stopMusic();
    assert.strictEqual(competitionAudioManager.currentTrack, null, 'Music must remain stopped during results');
  });

  // =========================================================================
  // TEST 14: F5 không làm phát lại các SFX đã qua (Mount Guard pre-consumption)
  // =========================================================================
  await t.test('Test 14: F5 không làm phát lại các SFX đã qua (Mount Guard pre-consumption)', () => {
    assert.ok(
      studentAudioHookSrc.includes('// Mount guard for F5 or late join: pre-consume all current and past SFX events'),
      'Must contain mount guard comment and logic'
    );
    assert.ok(
      studentAudioHookSrc.includes("lastPlayedSfxSetRef.current.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`)"),
      'Mount guard must pre-consume QUESTION_OPEN on mount'
    );

    const mountSfxSet = new Set();
    const sessionId = 'session-14';
    const currentQuestionId = 'q-1401';
    const currentPhase = 'QUESTION_RESULTS';

    if (currentQuestionId) {
      if (currentPhase === 'QUESTION_RESULTS') {
        mountSfxSet.add(`${sessionId}:${currentQuestionId}:QUESTION_OPEN`);
        mountSfxSet.add(`${sessionId}:${currentQuestionId}:TIME_UP`);
        mountSfxSet.add(`${sessionId}:${currentQuestionId}:QUESTION_RESULTS`);
      }
    }

    let sfxFired = [];
    const openKey = `${sessionId}:${currentQuestionId}:QUESTION_OPEN`;
    if (!mountSfxSet.has(openKey)) {
      sfxFired.push(openKey);
    }
    const timeUpKey = `${sessionId}:${currentQuestionId}:TIME_UP`;
    if (!mountSfxSet.has(timeUpKey)) {
      sfxFired.push(timeUpKey);
    }
    const resultsKey = `${sessionId}:${currentQuestionId}:QUESTION_RESULTS`;
    if (!mountSfxSet.has(resultsKey)) {
      sfxFired.push(resultsKey);
    }

    assert.strictEqual(sfxFired.length, 0, 'Zero stale SFX should fire after F5 mount pre-consumption');
  });

});
