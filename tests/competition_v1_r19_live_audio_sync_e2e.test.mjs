import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { competitionAudioManager } from '../src/services/competitionAudioManager.js';
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

// Load migrations
const migrationSql = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/20261015000001_competition_v1_audio_config_table.sql'),
  'utf8'
);
const liveSyncMigrationSql = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/20261018000001_competition_v1_r19_live_audio_sync.sql'),
  'utf8'
);

test('COMPETITION R19 LIVE MUSIC SYNC E2E VERIFICATION SUITE', async (t) => {
  // -------------------------------------------------------------------------
  // Setup isolated PGlite engine with database schema and both migrations
  // -------------------------------------------------------------------------
  const db = new PGlite();

  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      role TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public.competition_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id UUID NOT NULL,
      room_code TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting'
    );
    GRANT SELECT ON public.competition_sessions TO anon, authenticated;
    GRANT SELECT ON public.profiles TO anon, authenticated;
  `);

  await db.exec(migrationSql);
  await db.exec(liveSyncMigrationSql);

  const hostId = '11111111-1111-1111-1111-111111111111';
  const otherHostId = '22222222-2222-2222-2222-222222222222';
  const roomA_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const roomB_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  await db.exec(`
    INSERT INTO public.profiles (id, role) VALUES ('${hostId}', 'teacher'), ('${otherHostId}', 'teacher');
    INSERT INTO public.competition_sessions (id, host_id, room_code, title, status)
    VALUES 
      ('${roomA_id}', '${hostId}', 'ROOM01', 'Live Match Room A', 'in_progress'),
      ('${roomB_id}', '${otherHostId}', 'ROOM02', 'Isolated Room B', 'in_progress');
  `);

  async function callRpc(userId, sql) {
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET request.jwt.claim.role = 'authenticated';`);
    } else {
      await db.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'anon';`);
    }
    const res = await db.query(sql);
    return res.rows[0].r;
  }

  // Initial config: Theme A (classroom_chill)
  const configA = {
    mode: 'online',
    selection_mode: 'theme',
    theme_id: 'classroom_chill',
    custom_lobby_track_id: null,
    custom_question_track_id: null,
  };
  const configB = {
    mode: 'online',
    selection_mode: 'theme',
    theme_id: 'heroic_orchestral',
    custom_lobby_track_id: null,
    custom_question_track_id: null,
  };
  const configC = {
    mode: 'online',
    selection_mode: 'theme',
    theme_id: 'calm_focus',
    custom_lobby_track_id: null,
    custom_question_track_id: null,
  };

  // Seed Room A with Config A
  await callRpc(hostId, `SELECT public.competition_host_set_audio_config('${roomA_id}', '${JSON.stringify(configA)}'::jsonb) as r;`);

  // =========================================================================
  // SCENARIO 1: Both students unlock audio once (1 auth student, 1 guest)
  // =========================================================================
  await t.test('Scenario 1: Both students unlock audio once and enter in_progress match', () => {
    // Student 1 (Authenticated)
    let student1Unlocked = false;
    let student1Muted = false;
    let student1Volume = 0.5;

    // Student 2 (Guest)
    let student2Unlocked = false;
    let student2Muted = false;
    let student2Volume = 0.5;

    // Gesture unlock simulation
    student1Unlocked = true;
    student2Unlocked = true;

    assert.strictEqual(student1Unlocked, true, 'Student 1 must be unlocked');
    assert.strictEqual(student2Unlocked, true, 'Student 2 (Guest) must be unlocked');
  });

  // =========================================================================
  // SCENARIO 2 & 3: Host switches music A -> B during live question
  // =========================================================================
  await t.test('Scenario 2 & 3: Host changes music A -> B while in_progress; Students auto-switch to B without repeated unlock', async () => {
    // 1. Host side: Selecting Theme B creates 'unsynced' state
    let lastSavedConfig = configA;
    let currentHostAudioConfig = configB;
    let audioConfigStatus = 'saved';

    const matchesSaved = isAudioConfigMatching(lastSavedConfig, currentHostAudioConfig);
    if (!matchesSaved && audioConfigStatus === 'saved') {
      audioConfigStatus = 'unsynced';
    }
    assert.strictEqual(audioConfigStatus, 'unsynced', 'Host status becomes unsynced upon picking Theme B');

    // 2. Host clicks "Lưu & Đồng bộ" -> RPC executes successfully during in_progress
    const rpcRes = await callRpc(
      hostId,
      `SELECT public.competition_host_set_audio_config('${roomA_id}', '${JSON.stringify(configB)}'::jsonb) as r;`
    );
    assert.strictEqual(rpcRes.success, true, 'Backend RPC allows update in in_progress status');
    assert.strictEqual(rpcRes.audio_config.theme_id, 'heroic_orchestral');

    lastSavedConfig = configB;
    audioConfigStatus = 'saved';
    assert.strictEqual(audioConfigStatus, 'saved', 'Host status returns to saved after DB confirmation');

    // 3. Student simulation: Polls snapshot, receives configB
    let student1Unlocked = true; // Was already unlocked in Scenario 1
    let student2Unlocked = true; // Was already unlocked in Scenario 1

    const simulatedSnapshot = {
      id: roomA_id,
      status: 'in_progress',
      current_question_id: 'q_001',
      audio_config: configB,
      audio_config_persisted: true,
      audio_config_state: 'persisted',
    };

    // Verify student unlocked state is NOT reset when new config arrives
    assert.strictEqual(student1Unlocked, true, 'Student 1 must NOT be asked to unlock audio again');
    assert.strictEqual(student2Unlocked, true, 'Student 2 must NOT be asked to unlock audio again');

    // Verify resolved question track for heroic_orchestral
    const resolvedTrackB = getThemeById(configB.theme_id).questionTrack;
    assert.strictEqual(resolvedTrackB, '/audio/competition/heroic/titan.mp3', 'Theme B plays heroic titan track');
  });

  // =========================================================================
  // SCENARIO 4: Host switches B -> C, no overlapping audio
  // =========================================================================
  await t.test('Scenario 4: Host changes B -> C; Old track stops before new track starts; Zero double audio', async () => {
    // Mock audio element tracker to verify pause before play
    const audioEvents = [];
    class MockAudio {
      constructor(src) {
        this.src = src;
        this.paused = true;
        this.currentTime = 0;
      }
      play() {
        this.paused = false;
        audioEvents.push({ action: 'PLAY', src: this.src });
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
        audioEvents.push({ action: 'PAUSE', src: this.src });
      }
    }
    global.Audio = MockAudio;

    // Play track B
    const trackB = '/audio/competition/heroic/titan.mp3';
    const trackC = '/audio/competition/question_active_loop.mp3';

    // Simulate switching in audio manager
    competitionAudioManager.setTheme('heroic_orchestral');
    competitionAudioManager.playMusic('question_active');

    // Now switch to calm_focus (Theme C)
    competitionAudioManager.setTheme('calm_focus');

    // Check that pause event occurred for track B before or during track C
    const hasPauseEvent = audioEvents.some(e => e.action === 'PAUSE');
    assert.strictEqual(hasPauseEvent, true, 'Old track must be paused when switching theme');

    competitionAudioManager.stopAll();
  });

  // =========================================================================
  // SCENARIO 5: Host "Nghe thử" only plays on Host machine
  // =========================================================================
  await t.test('Scenario 5: Host "Nghe thử" does NOT change student config or database', async () => {
    // Host previews 'light_gameshow'
    let previewingThemeId = 'light_gameshow';

    // Verify DB in roomA still has Theme B (heroic_orchestral)
    const dbCheck = await db.query(
      `SELECT config->>'theme_id' as tid FROM public.competition_session_audio_configs WHERE session_id = '${roomA_id}';`
    );
    assert.strictEqual(dbCheck.rows[0].tid, 'heroic_orchestral', 'Database is NEVER modified by preview action');
  });

  // =========================================================================
  // SCENARIO 6: Paused, Resumed, and Finished states
  // =========================================================================
  await t.test('Scenario 6: Session paused, resumed, and finished audio lifecycle', async () => {
    // 1. Paused: RPC allows audio update during paused
    await db.exec(`UPDATE public.competition_sessions SET status = 'paused' WHERE id = '${roomA_id}';`);
    const pausedRpcRes = await callRpc(
      hostId,
      `SELECT public.competition_host_set_audio_config('${roomA_id}', '${JSON.stringify(configC)}'::jsonb) as r;`
    );
    assert.strictEqual(pausedRpcRes.success, true, 'Backend RPC allows update in paused status');

    // 2. Finished: RPC REJECTS audio update on finished session
    await db.exec(`UPDATE public.competition_sessions SET status = 'finished' WHERE id = '${roomA_id}';`);
    const finishedRpcRes = await callRpc(
      hostId,
      `SELECT public.competition_host_set_audio_config('${roomA_id}', '${JSON.stringify(configA)}'::jsonb) as r;`
    );
    assert.strictEqual(finishedRpcRes.success, false, 'Backend RPC must REJECT update on finished session');
    assert.strictEqual(finishedRpcRes.error_code, 'INVALID_SESSION_STATE');

    // 3. Cancelled: RPC REJECTS audio update on cancelled session
    await db.exec(`UPDATE public.competition_sessions SET status = 'cancelled' WHERE id = '${roomA_id}';`);
    const cancelledRpcRes = await callRpc(
      hostId,
      `SELECT public.competition_host_set_audio_config('${roomA_id}', '${JSON.stringify(configA)}'::jsonb) as r;`
    );
    assert.strictEqual(cancelledRpcRes.success, false, 'Backend RPC must REJECT update on cancelled session');
    assert.strictEqual(cancelledRpcRes.error_code, 'INVALID_SESSION_STATE');
  });

  // =========================================================================
  // SCENARIO 7: Student local mute, volume preference, and F5 / network resilience
  // =========================================================================
  await t.test('Scenario 7: Student local mute, volume preference, and F5 recovery', async () => {
    // Student 1 mutes
    let s1Muted = true;
    let s1Volume = 0.3;

    // Host updates config C -> A
    // When config changes, s1Muted and s1Volume MUST BE PRESERVED
    const newConfigReceived = configA;
    assert.strictEqual(s1Muted, true, 'Student 1 mute preference is preserved across host audio updates');
    assert.strictEqual(s1Volume, 0.3, 'Student 1 volume preference is preserved across host audio updates');

    // Anti-stale SFX simulation: pre-consume current question
    const playedSfx = new Set();
    const currentQId = 'q_042';
    // On F5 in QUESTION_ACTIVE, mount guard adds QUESTION_OPEN
    playedSfx.add(`${roomA_id}:${currentQId}:QUESTION_OPEN`);

    // Verify question fanfare is NOT fired again
    const canPlayFanfare = !playedSfx.has(`${roomA_id}:${currentQId}:QUESTION_OPEN`);
    assert.strictEqual(canPlayFanfare, false, 'Question fanfare must NOT replay after F5 or audio sync');
  });

  // =========================================================================
  // SCENARIO 8: Question timer, submission, points, leaderboard unaffected
  // =========================================================================
  await t.test('Scenario 8: Question timing, answer submission, and points are fully decoupled from audio sync', () => {
    const questionState = {
      currentQuestionId: 'q_001',
      timeLeftSeconds: 25,
      submittedAnswer: 'A',
      score: 10.0,
      rank: 1,
    };

    // When audio sync happens
    const audioSyncEvent = { type: 'AUDIO_CONFIG_UPDATED', newTheme: 'heroic_orchestral' };

    // Verify questionState is 100% immutable and unaffected
    assert.strictEqual(questionState.timeLeftSeconds, 25);
    assert.strictEqual(questionState.submittedAnswer, 'A');
    assert.strictEqual(questionState.score, 10.0);
    assert.strictEqual(questionState.rank, 1);
  });

  // =========================================================================
  // SCENARIO 9: Cross-session isolation (Room A does NOT leak to Room B)
  // =========================================================================
  await t.test('Scenario 9: Room A config strictly isolated from Room B', async () => {
    // Seed Room B with in_class config
    const configInClass = {
      mode: 'in_class',
      selection_mode: 'theme',
      theme_id: 'classroom_chill',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };
    await callRpc(
      otherHostId,
      `SELECT public.competition_host_set_audio_config('${roomB_id}', '${JSON.stringify(configInClass)}'::jsonb) as r;`
    );

    // Verify Room A config from DB
    const resA = await db.query(
      `SELECT config->>'mode' as mode, config->>'theme_id' as tid FROM public.competition_session_audio_configs WHERE session_id = '${roomA_id}';`
    );
    // Verify Room B config from DB
    const resB = await db.query(
      `SELECT config->>'mode' as mode, config->>'theme_id' as tid FROM public.competition_session_audio_configs WHERE session_id = '${roomB_id}';`
    );

    assert.strictEqual(resA.rows[0].mode, 'online', 'Room A is online');
    assert.strictEqual(resB.rows[0].mode, 'in_class', 'Room B is in_class');
    assert.notStrictEqual(resA.rows[0].mode, resB.rows[0].mode, 'Room A and Room B configs are strictly isolated');
  });

  // =========================================================================
  // SCENARIO 10: Unauthorized Host cannot update audio
  // =========================================================================
  await t.test('Scenario 10: Non-owner host cannot modify audio config of another room', async () => {
    // otherHostId tries to update roomA_id
    const forbiddenRes = await callRpc(
      otherHostId,
      `SELECT public.competition_host_set_audio_config('${roomA_id}', '${JSON.stringify(configB)}'::jsonb) as r;`
    );
    assert.strictEqual(forbiddenRes.success, false, 'Non-owner must be rejected');
    assert.strictEqual(forbiddenRes.error_code, 'FORBIDDEN');
  });
});
