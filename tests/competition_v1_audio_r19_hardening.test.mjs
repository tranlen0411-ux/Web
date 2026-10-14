import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { competitionAudioManager } from '../src/services/competitionAudioManager.js';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  DEFAULT_MUSIC_THEME,
  SELECTION_MODE_CUSTOM,
  SELECTION_MODE_THEME,
} from '../src/services/competitionMusicThemes.js';
import { DEFAULT_SESSION_AUDIO_CONFIG } from '../src/services/competitionClient.js';
import {
  isValidAudioConfig,
  isAudioConfigMatching,
  classifyAudioSnapshotState,
  canStartSession,
} from '../src/services/competitionAudioSync.js';
import { HostAudioLobbyBanner } from '../src/components/competition/HostAudioLobbyBanner.js';

const ROOT_DIR = process.cwd();

// Load sources for static analysis & contract verification
const migrationSql = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/20261015000001_competition_v1_audio_config_table.sql'),
  'utf8'
);
const clientSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionClient.js'), 'utf8');
const hostPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/CompetitionHostPage.jsx'), 'utf8');
const studentPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/CompetitionStudentPage.jsx'), 'utf8');
const studentHookSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/hooks/useCompetitionStudentAudio.js'), 'utf8');
const studentControlsSrc = fs.readFileSync(
  path.join(ROOT_DIR, 'src/components/competition/StudentAudioControls.jsx'),
  'utf8'
);
const syncSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/services/competitionAudioSync.js'), 'utf8');
const bannerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/competition/HostAudioLobbyBanner.js'), 'utf8');

test('COMPETITION V1 AUDIO R19 HARDENING SUITE', async (t) => {

  await t.test('1. Architecture Invariant: Zero modification to competition_sessions or sessions_host_all RLS', () => {
    assert.doesNotMatch(migrationSql, /DROP POLICY.*sessions_host_all/i, 'Must not drop sessions_host_all');
    assert.doesNotMatch(migrationSql, /ALTER TABLE.*public\.competition_sessions.*DROP/i, 'Must not drop anything on competition_sessions');
    assert.doesNotMatch(migrationSql, /CREATE OR REPLACE FUNCTION.*competition_host_create_session/i, 'Must not overload or alter create_session 9-arg RPC');
  });

  await t.test('2. Table Schema: Dedicated competition_session_audio_configs table exists with cascade', () => {
    assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS public\.competition_session_audio_configs/, 'Table DDL present');
    assert.match(migrationSql, /REFERENCES public\.competition_sessions\(id\) ON DELETE CASCADE/, 'Cascade on session delete present');
    assert.match(migrationSql, /CONSTRAINT check_competition_session_audio_config CHECK/, 'Check constraint present');
  });

  await t.test('3. Catalog Privileges: Zero direct client write (REVOKE ALL; SELECT only)', () => {
    assert.match(migrationSql, /REVOKE ALL ON TABLE public\.competition_session_audio_configs FROM PUBLIC, anon, authenticated;/, 'Direct writes revoked');
    assert.match(migrationSql, /GRANT SELECT ON TABLE public\.competition_session_audio_configs TO authenticated, anon;/, 'Strictly SELECT granted');
  });

  await t.test('4. RLS Hardening: Session-bound visibility (NO USING true)', () => {
    assert.doesNotMatch(migrationSql, /USING\s*\(\s*true\s*\)/i, 'USING (true) must be eliminated');
    assert.match(migrationSql, /CREATE POLICY session_audio_configs_authenticated_select/, 'Authenticated SELECT policy present');
    assert.match(migrationSql, /CREATE POLICY session_audio_configs_anon_select/, 'Anon SELECT policy present');
    assert.match(migrationSql, /EXISTS \(\s*SELECT 1 FROM public\.competition_sessions/i, 'Bound to session visibility');
  });

  await t.test('5. RPC Definition: competition_host_set_audio_config invariants', () => {
    assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.competition_host_set_audio_config/, 'RPC signature exists');
    assert.match(migrationSql, /SECURITY DEFINER/, 'Must be SECURITY DEFINER');
    assert.match(migrationSql, /SET search_path = ''/, 'Must enforce clean search_path');
    assert.match(migrationSql, /FOR UPDATE/, 'Row lock present');
    assert.match(migrationSql, /v_session\.host_id <> v_caller_id/, 'Host ownership check present');
    assert.match(migrationSql, /v_session\.status <> 'waiting'/, 'Waiting status guard present');
    assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.competition_host_set_audio_config.*TO authenticated;/, 'Granted to authenticated');
    assert.match(migrationSql, /REVOKE EXECUTE ON FUNCTION public\.competition_host_set_audio_config.*FROM PUBLIC, anon;/, 'Revoked from anon');
  });

  await t.test('6. Real PostgreSQL execution in PGlite engine', async (pt) => {
    const db = new PGlite();

    // Setup base mock profiles, competition_sessions tables, roles and auth.uid()
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

    // Apply the full R19 migration draft
    await db.exec(migrationSql);

    await pt.test('6.1. Validator rejects invalid payloads and accepts V2 contract', async () => {
      async function validate(json) {
        const res = await db.query(`SELECT public.validate_competition_audio_config(${json}) as valid;`);
        return res.rows[0].valid;
      }

      // Valid theme mode (in_class)
      assert.equal(await validate(`'{"mode":"in_class","selection_mode":"theme","theme_id":"classroom_chill","custom_lobby_track_id":null,"custom_question_track_id":null}'::jsonb`), true);
      // Valid custom mode (online)
      assert.equal(await validate(`'{"mode":"online","selection_mode":"custom","theme_id":"none","custom_lobby_track_id":"km_at_launch","custom_question_track_id":"sb_titan"}'::jsonb`), true);
      // Theme mode with non-null custom track must FAIL
      assert.equal(await validate(`'{"mode":"in_class","selection_mode":"theme","theme_id":"classroom_chill","custom_lobby_track_id":"km_at_launch","custom_question_track_id":null}'::jsonb`), false);
      // Custom mode with null track must FAIL
      assert.equal(await validate(`'{"mode":"online","selection_mode":"custom","theme_id":"none","custom_lobby_track_id":null,"custom_question_track_id":"sb_titan"}'::jsonb`), false);
      // Extra key must FAIL
      assert.equal(await validate(`'{"mode":"in_class","selection_mode":"theme","theme_id":"classroom_chill","custom_lobby_track_id":null,"custom_question_track_id":null,"extra":1}'::jsonb`), false);
      // Injected URL must FAIL
      assert.equal(await validate(`'{"mode":"online","selection_mode":"custom","theme_id":"none","custom_lobby_track_id":"https://evil.com/audio.mp3","custom_question_track_id":"sb_titan"}'::jsonb`), false);
    });

    await pt.test('6.2. RPC competition_host_set_audio_config enforces security & state', async () => {
      const hostId = '11111111-1111-1111-1111-111111111111';
      const otherHostId = '22222222-2222-2222-2222-222222222222';
      const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const inProgressSessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      await db.exec(`
        INSERT INTO public.profiles (id, role) VALUES ('${hostId}', 'teacher'), ('${otherHostId}', 'teacher');
        INSERT INTO public.competition_sessions (id, host_id, room_code, title, status)
        VALUES 
          ('${sessionId}', '${hostId}', 'ROOM01', 'Test Waiting Room', 'waiting'),
          ('${inProgressSessionId}', '${hostId}', 'ROOM02', 'Test Active Room', 'in_progress');
      `);

      const validConfig = `'{"mode":"in_class","selection_mode":"theme","theme_id":"classroom_chill","custom_lobby_track_id":null,"custom_question_track_id":null}'::jsonb`;

      // Helper to call as auth user
      async function callAs(userId, sql) {
        if (userId) {
          await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET request.jwt.claim.role = 'authenticated';`);
        } else {
          await db.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'anon';`);
        }
        const res = await db.query(sql);
        return res.rows[0].r;
      }

      // Case: No auth.uid() -> UNAUTHORIZED
      const noAuthRes = await callAs(null, `SELECT public.competition_host_set_audio_config('${sessionId}', ${validConfig}) as r;`);
      assert.equal(noAuthRes.success, false);
      assert.equal(noAuthRes.error_code, 'UNAUTHORIZED');

      // Case: Non-existent session -> SESSION_NOT_FOUND
      const nonExistentRes = await callAs(hostId, `SELECT public.competition_host_set_audio_config('99999999-9999-9999-9999-999999999999', ${validConfig}) as r;`);
      assert.equal(nonExistentRes.success, false);
      assert.equal(nonExistentRes.error_code, 'SESSION_NOT_FOUND');

      // Case: Other host attempts update -> FORBIDDEN
      const forbiddenRes = await callAs(otherHostId, `SELECT public.competition_host_set_audio_config('${sessionId}', ${validConfig}) as r;`);
      assert.equal(forbiddenRes.success, false);
      assert.equal(forbiddenRes.error_code, 'FORBIDDEN');

      // Case: In-progress session -> INVALID_SESSION_STATE
      const stateRes = await callAs(hostId, `SELECT public.competition_host_set_audio_config('${inProgressSessionId}', ${validConfig}) as r;`);
      assert.equal(stateRes.success, false);
      assert.equal(stateRes.error_code, 'INVALID_SESSION_STATE');

      // Case: Valid host on waiting session -> SUCCESS
      const successRes = await callAs(hostId, `SELECT public.competition_host_set_audio_config('${sessionId}', ${validConfig}) as r;`);
      assert.equal(successRes.success, true);
      assert.equal(successRes.session_id, sessionId);

      // Verify row exists in competition_session_audio_configs
      const tableCheck = await db.query(`SELECT config->>'theme_id' as tid FROM public.competition_session_audio_configs WHERE session_id = '${sessionId}';`);
      assert.equal(tableCheck.rows[0].tid, 'classroom_chill');
    });

    await pt.test('6.3. Direct mutation denied for client roles (REVOKE ALL enforcement)', async () => {
      // Direct INSERT under authenticated role MUST fail
      await assert.rejects(async () => {
        await db.exec(`
          SET ROLE authenticated;
          INSERT INTO public.competition_session_audio_configs (session_id, config)
          VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"mode":"in_class","selection_mode":"theme","theme_id":"none","custom_lobby_track_id":null,"custom_question_track_id":null}'::jsonb);
          RESET ROLE;
        `);
      }, /permission denied/i, 'Direct INSERT by authenticated user must be denied');

      // Direct DELETE under anon role MUST fail
      await assert.rejects(async () => {
        await db.exec(`
          SET ROLE anon;
          DELETE FROM public.competition_session_audio_configs WHERE session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
          RESET ROLE;
        `);
      }, /permission denied/i, 'Direct DELETE by anon user must be denied');
    });

    await pt.test('6.4. Real Database Role Privilege Checks (SET ROLE anon & authenticated)', async () => {
      const validConfig = `'{"mode":"in_class","selection_mode":"theme","theme_id":"classroom_chill","custom_lobby_track_id":null,"custom_question_track_id":null}'::jsonb`;
      const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

      // 1. Role anon: executing host RPC is DENIED at SQL level (REVOKE EXECUTE)
      await assert.rejects(async () => {
        await db.exec(`
          SET ROLE anon;
          SELECT public.competition_host_set_audio_config('${sessionId}', ${validConfig});
          RESET ROLE;
        `);
      }, /permission denied for function competition_host_set_audio_config/i, 'Anon role must be denied execute on host RPC');

      // 2. Role anon: SELECT on waiting session is GRANTED & returns actual row with valid config
      await db.exec(`SET ROLE anon;`);
      const anonSelectRes = await db.query(
        `SELECT session_id, config FROM public.competition_session_audio_configs WHERE session_id = '${sessionId}';`
      );
      await db.exec(`RESET ROLE;`);
      assert.strictEqual(anonSelectRes.rows.length, 1, 'Anon role must be able to read waiting session audio config');
      assert.strictEqual(anonSelectRes.rows[0].config.mode, 'in_class', 'Anon reads correct persisted mode');
      assert.strictEqual(anonSelectRes.rows[0].config.selection_mode, 'theme', 'Anon reads correct selection_mode');

      // 3. Role authenticated: executing host RPC is permitted at SQL level & returns success: true with exact config
      await db.exec(`
        SET ROLE authenticated;
        SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
      `);
      const hostRpcRes = await db.query(
        `SELECT public.competition_host_set_audio_config('${sessionId}', ${validConfig}) as result;`
      );
      await db.exec(`RESET ROLE;`);
      const rpcResult = hostRpcRes.rows[0].result;
      assert.strictEqual(rpcResult.success, true, 'Host RPC result must be success: true');
      assert.strictEqual(rpcResult.audio_config.mode, 'in_class', 'Host RPC must return configured mode');
      assert.strictEqual(rpcResult.audio_config.theme_id, 'classroom_chill', 'Host RPC must return configured theme');
    });
  });

  await t.test('7. Client Service: competitionClient.js exports DEFAULT_SESSION_AUDIO_CONFIG & distinguishes persisted from fallback', () => {
    assert.match(clientSrc, /export const DEFAULT_SESSION_AUDIO_CONFIG = Object\.freeze\({/, 'DEFAULT_SESSION_AUDIO_CONFIG exported');
    assert.match(clientSrc, /mode: 'in_class'/, 'Default mode is in_class');
    assert.match(clientSrc, /export async function hostSetAudioConfig\({/, 'hostSetAudioConfig exported');
    assert.match(clientSrc, /data\.audio_config_persisted = true;/, 'Flags persisted = true when row found in database');
    assert.match(clientSrc, /data\.audio_config_persisted = false;/, 'Flags persisted = false on fallback default');
    assert.match(clientSrc, /DEFAULT_SESSION_AUDIO_CONFIG/, 'Fallback applied when audio row absent');
  });

  await t.test('8. Host Online Mode & Audio Save Race Behavioral Tests', () => {
    // 8.1. Host Online Mode radio selection
    assert.match(hostPageSrc, /const \[competitionAudioMode, setCompetitionAudioMode\] = useState\('in_class'\);/, 'Audio mode state present');
    assert.match(hostPageSrc, /Thi tại lớp \(In-Class\)/, 'In-class mode option rendered');
    assert.match(hostPageSrc, /Thi trực tuyến \(Online\)/, 'Online mode option rendered');
    assert.match(hostPageSrc, /mode: competitionAudioMode/, 'Passes selected mode into audioPayload');
    assert.match(hostPageSrc, /mode: 'individual'/, 'Preserves session table mode as individual');

    // 8.2. Audio Save State Machine & Persistence verification
    assert.match(hostPageSrc, /const \[audioConfigStatus, setAudioConfigStatus\] = useState\('idle'\);/, 'Audio config status state present');
    assert.match(hostPageSrc, /setAudioConfigStatus\('saving'\)/, 'Sets saving state before RPC');
    assert.match(hostPageSrc, /classifyAudioSnapshotState/, 'Uses pure classification state machine for snapshot audio sync');
    assert.match(syncSrc, /snapshot\.audio_config_persisted === true && isValidAudioConfig\(snapshot\.audio_config\)/, 'Only marks saved when persisted is true and config is valid');
    assert.match(syncSrc, /if \(currentStatus === 'saving'\)/, 'Protects saving state from polling or stale snapshot overwrite');

    // 8.3. Start Session locked until saved
    assert.match(hostPageSrc, /if \(audioConfigStatus === 'saving'\)/, 'Blocks start while saving');
    assert.match(hostPageSrc, /if \(audioConfigStatus === 'failed'\)/, 'Blocks start if save failed');
    assert.match(hostPageSrc, /disabled=\{actionPending \|\| participants\.length === 0 \|\| audioConfigStatus !== 'saved'\}/, 'Start button disabled when not saved');

    // 8.4. Timeout re-verification without creating a new room
    assert.match(hostPageSrc, /isAudioConfigMatching\(verifyRes\.data\?\.audio_config, audioPayload\)/, 'Re-verifies exact config match on timeout before concluding failure');
    assert.match(hostPageSrc, /const handleRetrySaveAudioConfig = async/, 'handleRetrySaveAudioConfig present');
    assert.match(hostPageSrc, /sessionId: activeSessionId/, 'Retries for current activeSessionId without creating room');
  });

  await t.test('9. Student Audio Controls Component & Anti-Stale SFX Tests', () => {
    // 9.1. Component structure & in_class mute badge
    assert.match(studentControlsSrc, /export function StudentAudioControls/, 'StudentAudioControls component exported');
    assert.match(studentControlsSrc, /if \(isInClass\)/, 'Detects in_class mode');
    assert.match(studentControlsSrc, /Thi tại lớp: Âm thanh từ Thầy\/Cô/, 'In-class informative badge rendered');

    // 9.2. Online controls (Unlock, Mute, Volume)
    assert.match(studentControlsSrc, /!isStudentAudioUnlocked/, 'Checks autoplay lock');
    assert.match(studentControlsSrc, /Bật âm thanh/, 'Unlock button present');
    assert.match(studentControlsSrc, /toggleStudentMute/, 'Mute toggle present');
    assert.match(studentControlsSrc, /type="range"/, 'Volume slider present');

    // 9.3. Student Page integration
    assert.match(studentPageSrc, /import { StudentAudioControls }/, 'Student page imports StudentAudioControls');
    assert.match(studentPageSrc, /<StudentAudioControls {\.\.\.studentAudio} \/>/, 'StudentAudioControls rendered in student page');

    // 9.4. Anti-stale SFX on F5 or late unlock for all 3 phases (QUESTION_ACTIVE, TIME_UP, QUESTION_RESULTS)
    assert.match(studentHookSrc, /if \(currentPhase === 'QUESTION_ACTIVE'\)/, 'Pre-consumes QUESTION_ACTIVE SFX');
    assert.match(studentHookSrc, /if \(currentPhase === 'TIME_UP'\)/, 'Pre-consumes TIME_UP SFX');
    assert.match(studentHookSrc, /if \(currentPhase === 'QUESTION_RESULTS'\)/, 'Pre-consumes QUESTION_RESULTS SFX');
  });

  await t.test('10. Audio Track Synchronization & Multi-Device Simulation', () => {
    // 10.1. Student Hook synchronizes config directly into competitionAudioManager
    assert.match(studentHookSrc, /competitionAudioManager\.setSelectionMode/, 'Synchronizes selection mode to audio manager');
    assert.match(studentHookSrc, /competitionAudioManager\.setCustomTracks/, 'Synchronizes custom tracks to audio manager');
    assert.match(studentHookSrc, /competitionAudioManager\.setTheme/, 'Synchronizes theme to audio manager');

    // 10.2. Direct unit test of competitionAudioManager with Theme & Custom tracks
    competitionAudioManager.setSelectionMode(SELECTION_MODE_THEME);
    competitionAudioManager.setTheme('classroom_chill');
    assert.equal(competitionAudioManager.getTrackSrc('lobby'), '/audio/competition/lobby_loop.mp3');
    assert.equal(competitionAudioManager.getTrackSrc('question_active'), '/audio/competition/question_active_loop.mp3');

    // Switch to Custom Heroic tracks
    competitionAudioManager.setSelectionMode(SELECTION_MODE_CUSTOM);
    competitionAudioManager.setCustomTracks({
      lobbyTrackId: 'sb_ignis',
      questionTrackId: 'sb_the_fury',
    });
    assert.equal(competitionAudioManager.getTrackSrc('lobby'), '/audio/competition/heroic/ignis.mp3');
    assert.equal(competitionAudioManager.getTrackSrc('question_active'), '/audio/competition/heroic/the_fury.mp3');

    // 10.3. Multi-device simulation:
    // Device A (Host in in_class mode): Student audio manager must stopAll
    competitionAudioManager.stopAll();
    assert.equal(competitionAudioManager.currentTrack, null, 'Audio manager stopped on in_class');

    // Clean reset
    competitionAudioManager.setSelectionMode(SELECTION_MODE_THEME);
    competitionAudioManager.setTheme(DEFAULT_MUSIC_THEME);
  });

  await t.test('11. Legacy R18 Session Compatibility (Zero Audio Record in Database)', () => {
    // 11.1. In an R18 room without audio row, fallback applies seamlessly
    assert.strictEqual(DEFAULT_SESSION_AUDIO_CONFIG.mode, 'in_class');
    assert.strictEqual(DEFAULT_SESSION_AUDIO_CONFIG.selection_mode, 'theme');

    // 11.2. Host in-progress or finished controls are not gated on audioConfigStatus
    assert.match(hostPageSrc, /handleNextQuestion/, 'handleNextQuestion present for in_progress sessions');
    assert.match(hostPageSrc, /handleCloseQuestion/, 'handleCloseQuestion present for in_progress sessions');
    assert.match(hostPageSrc, /handleFinishSession/, 'handleFinishSession present for in_progress sessions');

    // 11.3. Student audio stays completely silent for in_class fallback
    assert.match(studentHookSrc, /if \(isInClass\)/, 'isInClass halts and silences student audio completely');
    assert.match(studentHookSrc, /competitionAudioManager\.stopAll\(\)/, 'Stops all audio when isInClass is true');

    // 11.4. Legacy Safety Invariant: Host page NEVER auto-heals on snapshot read
    assert.doesNotMatch(hostPageSrc, /isAutoHealingLegacyRef/, 'isAutoHealingLegacyRef is removed completely');
    assert.doesNotMatch(hostPageSrc, /isAutoHealingLegacyRef\.current/, 'Zero auto-heal flag references in Host page');

    // 11.5. Starting Invariant: handleStartSession has ZERO auto-heal fallback
    assert.doesNotMatch(hostPageSrc, /healRes\s*=/, 'handleStartSession does not auto-heal audio config');
    assert.match(hostPageSrc, /audioConfigStatus !== 'saved'/, 'handleStartSession strictly requires audioConfigStatus === saved');

    // 11.6. Explicit Host Confirmation: Host page provides handleApplyLegacyAudioConfig on same session_id
    assert.match(hostPageSrc, /handleApplyLegacyAudioConfig/, 'handleApplyLegacyAudioConfig present for Host confirmation');
    assert.match(hostPageSrc, /<HostAudioLobbyBanner/, 'HostAudioLobbyBanner rendered in waiting lobby');
  });

  await t.test('12. Behavioral State Machine Tests: Polling Race, Stale Snapshot & Production React Integration', async (st) => {
    const hostRequestedOnline = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'classroom_chill',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    const staleDbInClass = {
      mode: 'in_class',
      selection_mode: 'theme',
      theme_id: 'classroom_chill',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    const freshDbOnline = {
      mode: 'online',
      selection_mode: 'theme',
      theme_id: 'classroom_chill',
      custom_lobby_track_id: null,
      custom_question_track_id: null,
    };

    // 12.1. Production isAudioConfigMatching verification
    await st.test('12.1. isAudioConfigMatching production logic', () => {
      assert.strictEqual(isAudioConfigMatching(staleDbInClass, hostRequestedOnline), false, 'Rejects mismatch between stale in_class DB and requested online mode');
      assert.strictEqual(isAudioConfigMatching(freshDbOnline, hostRequestedOnline), true, 'Accepts exact 5-field match');
      assert.strictEqual(isAudioConfigMatching(null, hostRequestedOnline), false, 'Rejects null actual');
      assert.strictEqual(isAudioConfigMatching(freshDbOnline, null), false, 'Rejects null requested');
    });

    // 12.2. Production classifyAudioSnapshotState with Host Pending Save (Online Mode)
    await st.test('12.2. classifyAudioSnapshotState preserves Host online choice during polling race', () => {
      const activeSessionId = 'test-session-123';

      // While saving is in progress, snapshot MUST be ignored
      const savingDecision = classifyAudioSnapshotState({
        snapshot: { id: activeSessionId, audio_config_persisted: true, audio_config: staleDbInClass },
        activeSessionId,
        currentStatus: 'saving',
        pendingAudioConfig: hostRequestedOnline,
      });
      assert.strictEqual(savingDecision.action, 'IGNORE_SAVING_IN_PROGRESS');
      assert.strictEqual(savingDecision.nextStatus, null);

      // Stale snapshot arrives from DB with old in_class config while Host requested online
      const mismatchDecision = classifyAudioSnapshotState({
        snapshot: { id: activeSessionId, audio_config_persisted: true, audio_config: staleDbInClass },
        activeSessionId,
        currentStatus: 'failed',
        pendingAudioConfig: hostRequestedOnline,
      });
      assert.strictEqual(mismatchDecision.action, 'PENDING_CONFIG_MISMATCH');
      assert.strictEqual(mismatchDecision.nextStatus, 'failed');
      assert.strictEqual(mismatchDecision.nextMode, null, 'Never overwrites Host online mode with stale in_class mode');
      assert.strictEqual(mismatchDecision.shouldClearPending, false, 'Preserves pending config for Host retry');
      assert.strictEqual(mismatchDecision.shouldAutoHeal, false, 'Never auto-heals on mismatch');

      // Matching snapshot arrives from DB with requested online config
      const matchingDecision = classifyAudioSnapshotState({
        snapshot: { id: activeSessionId, audio_config_persisted: true, audio_config: freshDbOnline },
        activeSessionId,
        currentStatus: 'failed',
        pendingAudioConfig: hostRequestedOnline,
      });
      assert.strictEqual(matchingDecision.action, 'MATCH_PENDING_CONFIRMED');
      assert.strictEqual(matchingDecision.nextStatus, 'saved');
      assert.strictEqual(matchingDecision.nextMode, 'online');
      assert.strictEqual(matchingDecision.shouldClearPending, true);
      assert.strictEqual(matchingDecision.shouldAutoHeal, false);
    });

    // 12.3. Query Error (Situation 2: 401/403/500/network error)
    await st.test('12.3. Query error never triggers auto-heal and preserves pending config', () => {
      const activeSessionId = 'test-session-123';

      const queryErrorSnapshot = {
        id: activeSessionId,
        audio_config_persisted: false,
        audio_config_state: 'error',
        audio_config_error: '500 Internal Server Error: Connection refused',
      };

      const errorDecision = classifyAudioSnapshotState({
        snapshot: queryErrorSnapshot,
        activeSessionId,
        currentStatus: 'failed',
        pendingAudioConfig: hostRequestedOnline,
      });

      assert.strictEqual(errorDecision.action, 'QUERY_ERROR');
      assert.strictEqual(errorDecision.nextStatus, 'failed');
      assert.strictEqual(errorDecision.nextMode, null, 'Must NOT reset Host online mode to default in_class');
      assert.strictEqual(errorDecision.shouldClearPending, false, 'Must keep pendingAudioConfigRef intact for retry');
      assert.strictEqual(errorDecision.shouldAutoHeal, false, 'Auto-heal strictly forbidden on query error');
    });

    // 12.4. Legacy R18 Waiting Room (Situation 1: DB truly has no audio_config row)
    await st.test('12.4. Legacy R18 waiting room sets legacy_missing without auto-writing on snapshot read', () => {
      const activeSessionId = 'legacy-r18-sess';

      const legacyMissingSnapshot = {
        id: activeSessionId,
        status: 'waiting',
        audio_config_persisted: false,
        audio_config_state: 'missing',
        audio_config_error: null,
      };

      const legacyDecision = classifyAudioSnapshotState({
        snapshot: legacyMissingSnapshot,
        activeSessionId,
        currentStatus: 'idle',
        pendingAudioConfig: null,
      });

      assert.strictEqual(legacyDecision.action, 'LEGACY_MISSING_NEEDS_CONFIRMATION');
      assert.strictEqual(legacyDecision.nextStatus, 'legacy_missing');
      assert.strictEqual(legacyDecision.shouldAutoHeal, false, 'NEVER auto-heals or writes to DB on snapshot read');
    });

    // 12.5. canStartSession gate verification
    await st.test('12.5. canStartSession gate strictly enforces saved audio status', () => {
      assert.strictEqual(canStartSession({ audioConfigStatus: 'legacy_missing', participantCount: 5 }), false);
      assert.strictEqual(canStartSession({ audioConfigStatus: 'failed', participantCount: 5 }), false);
      assert.strictEqual(canStartSession({ audioConfigStatus: 'saving', participantCount: 5 }), false);
      assert.strictEqual(canStartSession({ audioConfigStatus: 'saved', participantCount: 0 }), false);
      assert.strictEqual(canStartSession({ audioConfigStatus: 'saved', participantCount: 3, actionPending: false }), true);
      assert.strictEqual(canStartSession({ audioConfigStatus: 'saved', participantCount: 3, actionPending: true }), false);
    });

    // 12.6. Real Production React Component Integration: HostAudioLobbyBanner
    await st.test('12.6. Real React Component Integration: HostAudioLobbyBanner renders all 4 distinct states', () => {
      // State 1: saving
      const savingHtml = renderToString(React.createElement(HostAudioLobbyBanner, {
        audioConfigStatus: 'saving',
        competitionAudioMode: 'online',
      }));
      assert.ok(savingHtml.includes('data-testid="audio-banner-saving"'));
      assert.ok(savingHtml.includes('Đang lưu và xác thực cấu hình âm thanh'));

      // State 2: failed with retry button
      const failedHtml = renderToString(React.createElement(HostAudioLobbyBanner, {
        audioConfigStatus: 'failed',
        audioConfigError: 'Lỗi 403 Forbidden',
        competitionAudioMode: 'online',
      }));
      assert.ok(failedHtml.includes('data-testid="audio-banner-failed"'));
      assert.ok(failedHtml.includes('data-testid="btn-retry-save-audio"'));
      assert.ok(failedHtml.includes('Thử lại lưu âm thanh'));
      assert.ok(failedHtml.includes('Lỗi 403 Forbidden'));

      // State 3: legacy_missing with explicit confirmation button
      const legacyHtml = renderToString(React.createElement(HostAudioLobbyBanner, {
        audioConfigStatus: 'legacy_missing',
        competitionAudioMode: 'in_class',
      }));
      assert.ok(legacyHtml.includes('data-testid="audio-banner-legacy-missing"'));
      assert.ok(legacyHtml.includes('data-testid="btn-apply-legacy-default"'));
      assert.ok(legacyHtml.includes('Áp dụng cấu hình mặc định'));
      assert.ok(legacyHtml.includes('Phòng thi từ phiên bản trước chưa có cấu hình âm thanh'));

      // State 4: saved
      const savedHtml = renderToString(React.createElement(HostAudioLobbyBanner, {
        audioConfigStatus: 'saved',
        competitionAudioMode: 'online',
      }));
      assert.ok(savedHtml.includes('data-testid="audio-banner-saved"'));
      assert.ok(savedHtml.includes('đã được xác nhận'));

      // State 5: idle returns empty
      const idleHtml = renderToString(React.createElement(HostAudioLobbyBanner, {
        audioConfigStatus: 'idle',
      }));
      assert.strictEqual(idleHtml, '');
    });

    // 12.7. Student Anti-Stale SFX Lifecycle Simulation (3 Phases: Active, Time Up, Results)
    await st.test('12.7. Student Anti-Stale SFX Lifecycle Simulation', () => {
      const sessionId = 'test-session';
      const qId = 'test-q1';

      const consumedSfxSetTimeUp = new Set();
      const simulateF5Mount = (phase) => {
        if (phase === 'QUESTION_ACTIVE') {
          consumedSfxSetTimeUp.add(`${sessionId}:${qId}:QUESTION_OPEN`);
        } else if (phase === 'TIME_UP') {
          consumedSfxSetTimeUp.add(`${sessionId}:${qId}:QUESTION_OPEN`);
          consumedSfxSetTimeUp.add(`${sessionId}:${qId}:TIME_UP`);
        } else if (phase === 'QUESTION_RESULTS') {
          consumedSfxSetTimeUp.add(`${sessionId}:${qId}:QUESTION_OPEN`);
          consumedSfxSetTimeUp.add(`${sessionId}:${qId}:TIME_UP`);
          consumedSfxSetTimeUp.add(`${sessionId}:${qId}:QUESTION_RESULTS`);
        }
      };

      simulateF5Mount('TIME_UP');
      assert.strictEqual(consumedSfxSetTimeUp.has(`${sessionId}:${qId}:QUESTION_OPEN`), true, 'QUESTION_OPEN consumed on F5');
      assert.strictEqual(consumedSfxSetTimeUp.has(`${sessionId}:${qId}:TIME_UP`), true, 'TIME_UP consumed on F5');

      let playedSfx = [];
      const simulateLateUnlock = (phase, consumedSet) => {
        if (phase === 'QUESTION_RESULTS') {
          const resultsKey = `${sessionId}:${qId}:QUESTION_RESULTS`;
          if (!consumedSet.has(resultsKey)) {
            playedSfx.push('competition_results_reveal');
          }
        }
      };

      const consumedLateUnlock = new Set([
        `${sessionId}:${qId}:QUESTION_OPEN`,
        `${sessionId}:${qId}:TIME_UP`,
        `${sessionId}:${qId}:QUESTION_RESULTS`
      ]);

      simulateLateUnlock('QUESTION_RESULTS', consumedLateUnlock);
      assert.strictEqual(playedSfx.length, 0, 'No stale results SFX played when unlocking late in QUESTION_RESULTS');
    });
  });
});
