import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

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
    `);

    // Apply the full R19 migration draft
    await db.exec(migrationSql);

    await pt.test('6.1. Validator rejects invalid payloads and accepts V2 contract', async () => {
      async function validate(json) {
        const res = await db.query(`SELECT public.validate_competition_audio_config(${json}) as valid;`);
        return res.rows[0].valid;
      }

      // Valid theme mode
      assert.equal(await validate(`'{"mode":"in_class","selection_mode":"theme","theme_id":"classroom_chill","custom_lobby_track_id":null,"custom_question_track_id":null}'::jsonb`), true);
      // Valid custom mode
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

      // Case: No auth.uid() -> UNAUTHORIZED
      const noAuthRes = await db.query(`SELECT public.competition_host_set_audio_config('${sessionId}', ${validConfig}) as r;`);
      assert.equal(noAuthRes.rows[0].r.success, false);
      assert.equal(noAuthRes.rows[0].r.error_code, 'UNAUTHORIZED');

      // Helper to call as auth user
      async function callAs(userId, sql) {
        await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET request.jwt.claim.role = 'authenticated';`);
        const res = await db.query(sql);
        return res.rows[0].r;
      }

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
  });

  await t.test('7. Client Service: competitionClient.js exports DEFAULT_SESSION_AUDIO_CONFIG & hostSetAudioConfig', () => {
    assert.match(clientSrc, /export const DEFAULT_SESSION_AUDIO_CONFIG = Object\.freeze\({/, 'DEFAULT_SESSION_AUDIO_CONFIG exported');
    assert.match(clientSrc, /mode: 'in_class'/, 'Default mode is in_class');
    assert.match(clientSrc, /export async function hostSetAudioConfig\({/, 'hostSetAudioConfig exported');
    assert.match(clientSrc, /from\('competition_session_audio_configs'\)/, 'getSessionSnapshot queries audio config table');
    assert.match(clientSrc, /DEFAULT_SESSION_AUDIO_CONFIG/, 'Fallback applied when audio row absent');
  });

  await t.test('8. Host UI Integration: CompetitionHostPage persists audio with retry on session create', () => {
    assert.match(hostPageSrc, /hostSetAudioConfig/, 'CompetitionHostPage imports hostSetAudioConfig');
    assert.match(hostPageSrc, /hostSetAudioConfig\({\s*sessionId:\s*newSessionId/s, 'Persists audio with newSessionId');
    assert.match(hostPageSrc, /attempts\s*<\s*3/, 'Retry with max 3 attempts present');
  });

  await t.test('9. Student Audio State Machine: Independent from hostViewMode and enforces in_class mute', () => {
    assert.doesNotMatch(studentHookSrc, /hostViewMode/, 'Student hook must never reference hostViewMode');
    assert.match(studentHookSrc, /isInterimLeaderboardActive/, 'Uses authoritative isInterimLeaderboardActive for results');
    assert.match(studentHookSrc, /isInClass\s*=\s*mode\s*===\s*'in_class'/, 'in_class detected');
    assert.match(studentHookSrc, /if\s*\(isInClass.*competitionAudioManager\.stopAll\(\)/s, 'in_class forces stopAll');
    assert.match(studentHookSrc, /unlockStudentAudio/, 'Provides explicit unlock gesture');
    assert.match(studentPageSrc, /useCompetitionStudentAudio/, 'Student page integrates student audio hook');
    assert.doesNotMatch(studentPageSrc, /useCompetitionAudio\(/, 'Student page must not instantiate host hook');
  });
});
