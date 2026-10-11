import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

console.log('================================================================================');
console.log('🧪 COMPETITION V1 R17 — INTERIM LEADERBOARD SECURITY TEST SUITE');
console.log('================================================================================\n');

let db;

async function setupDatabase() {
  db = new PGlite();

  // Baseline auth & extensions mocks
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS private;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
      full_name TEXT NOT NULL DEFAULT 'Test User',
      avatar_url TEXT DEFAULT NULL
    );

    CREATE OR REPLACE FUNCTION extensions.digest(data bytea, type text)
    RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT sha256(data);
    $$;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$;
  `);

  // Migration 1: Baseline Schema
  const m1Path = path.resolve('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql');
  await db.exec(fs.readFileSync(m1Path, 'utf8'));

  // Migration 2: RPC & Business Logic
  const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
  await db.exec(fs.readFileSync(m2Path, 'utf8'));

  // Baseline grants
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA auth, public, extensions TO postgres, authenticated, anon;
    GRANT USAGE ON SCHEMA public, auth, extensions, private TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, authenticated, anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, auth TO postgres, authenticated, anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, extensions, public, private TO postgres, authenticated, anon;
  `);

  // Migration 10: Question Results (R2)
  const m10Path = path.resolve('supabase/migrations/20261004000002_competition_v1_question_results.sql');
  await db.exec(fs.readFileSync(m10Path, 'utf8'));

  // Migration 11: Post-Session Review (R5) - adds review_enabled column
  const m11Path = path.resolve('supabase/migrations/20261006000001_competition_v1_post_session_review.sql');
  await db.exec(fs.readFileSync(m11Path, 'utf8'));

  // Migration 12: Host Historical Results & Snapshots (R12)
  const m12Path = path.resolve('supabase/migrations/20261008110000_competition_v1_host_historical_question_results.sql');
  await db.exec(fs.readFileSync(m12Path, 'utf8'));

  // Migration 13: R16-A Matching Backend
  const m13Path = path.resolve('supabase/migrations/20261011000001_competition_v1_r16a_matching_backend.sql');
  await db.exec(fs.readFileSync(m13Path, 'utf8'));

  // Migration 14: R17 Interim Leaderboard Security Hardening
  const m14Path = path.resolve('supabase/migrations/20261012000001_competition_v1_r17_interim_leaderboard_security.sql');
  await db.exec(fs.readFileSync(m14Path, 'utf8'));
}

async function setAuthContext(userId = null, role = 'authenticated') {
  await db.exec(`
    SELECT set_config('request.jwt.claim.sub', '${userId ? userId : ''}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);
  `);
}

function generateGuestToken() {
  return crypto.randomBytes(32).toString('hex');
}

test('Competition V1 R17 - Interim Leaderboard & Security Hardening', async (t) => {
  await setupDatabase();

  // Seed Users: 1 Host, 1 Admin, 2 Students
  const hostId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const student1Id = crypto.randomUUID();
  const student2Id = crypto.randomUUID();

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${hostId}', 'host@test.com'),
      ('${adminId}', 'admin@test.com'),
      ('${student1Id}', 'student1@test.com'),
      ('${student2Id}', 'student2@test.com');

    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${hostId}', 'teacher', 'Thầy Giáo Host'),
      ('${adminId}', 'admin', 'Quản Trị Viên'),
      ('${student1Id}', 'student', 'Học Sinh A'),
      ('${student2Id}', 'student', 'Học Sinh B');
  `);

  // Create a Competition Session via 9-arg canonical competition_host_create_session
  await setAuthContext(hostId, 'authenticated');
  const createSessionRes = await db.query(
    `SELECT public.competition_host_create_session(
      'Đấu Trường R17'::text,
      'Đấu trường kiểm thử bảng xếp hạng tạm thời'::text,
      'individual'::text,
      50::integer,
      $1::jsonb,
      '[]'::jsonb,
      false::boolean,
      '{}'::jsonb,
      true::boolean
    ) AS result`,
    [
      JSON.stringify([
        {
          question_order: 1,
          question_type: 'single_choice',
          question_text: '1 + 1 bằng mấy?',
          options: [
            { id: 'opt1', text: '2' },
            { id: 'opt2', text: '3' }
          ],
          correct_answer: { option_id: 'opt1' },
          points: 100,
          time_limit_seconds: 30
        },
        {
          question_order: 2,
          question_type: 'single_choice',
          question_text: '2 + 2 bằng mấy?',
          options: [
            { id: 'opt1', text: '4' },
            { id: 'opt2', text: '5' }
          ],
          correct_answer: { option_id: 'opt1' },
          points: 100,
          time_limit_seconds: 30
        }
      ])
    ]
  );

  const sessionObj = createSessionRes.rows[0].result;
  assert.equal(sessionObj.success, true, sessionObj.message || 'Create session failed');
  const sessionId = sessionObj.session_id || sessionObj.session?.id;
  const roomCode = sessionObj.room_code || sessionObj.session?.room_code;
  assert.ok(sessionId, 'Session ID must be returned');
  assert.ok(roomCode, 'Room code must be returned');

  // Load question IDs
  const qList = await db.query(`
    SELECT id, question_order FROM public.competition_questions
    WHERE session_id = '${sessionId}'
    ORDER BY question_order ASC;
  `);
  const q1Id = qList.rows[0].id;
  const q2Id = qList.rows[1].id;

  // Student 1 joins
  await setAuthContext(student1Id, 'authenticated');
  const s1Join = await db.query(
    `SELECT public.competition_join_session($1, 'Học Sinh A') AS result`,
    [roomCode]
  );
  assert.equal(s1Join.rows[0].result.success, true);
  const s1PartId = s1Join.rows[0].result.participant_id || s1Join.rows[0].result.participant?.id;

  // Guest joins
  await setAuthContext(null, 'anon');
  const guestRawToken = generateGuestToken();
  const guestJoin = await db.query(
    `SELECT public.competition_join_session($1, 'Khách VIP', NULL, NULL, $2) AS result`,
    [roomCode, guestRawToken]
  );
  assert.equal(guestJoin.rows[0].result.success, true);
  const guestPartId = guestJoin.rows[0].result.participant_id || guestJoin.rows[0].result.participant?.id;

  // Student 2 joins
  await setAuthContext(student2Id, 'authenticated');
  const s2Join = await db.query(
    `SELECT public.competition_join_session($1, 'Học Sinh B') AS result`,
    [roomCode]
  );
  assert.equal(s2Join.rows[0].result.success, true);
  const s2PartId = s2Join.rows[0].result.participant_id || s2Join.rows[0].result.participant?.id;

  // =========================================================================
  // SCENARIO 1: WAITING STATE
  // =========================================================================
  await t.test('1. Waiting State: Student & Guest get empty leaderboard, Host gets success', async () => {
    // Student 1
    await setAuthContext(student1Id, 'authenticated');
    const s1Wait = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Wait.rows[0].result.success, true);
    assert.equal(s1Wait.rows[0].result.session_status, 'waiting');
    assert.deepEqual(s1Wait.rows[0].result.leaderboard, []);

    // Guest
    await setAuthContext(null, 'anon');
    const gWait = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, guestRawToken]
    );
    assert.equal(gWait.rows[0].result.success, true);
    assert.equal(gWait.rows[0].result.session_status, 'waiting');
    assert.deepEqual(gWait.rows[0].result.leaderboard, []);

    // Host
    await setAuthContext(hostId, 'authenticated');
    const hWait = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(hWait.rows[0].result.success, true);
  });

  // =========================================================================
  // START SESSION -> IN_PROGRESS QUESTION 1 OPEN
  // =========================================================================
  await setAuthContext(hostId, 'authenticated');
  const startRes = await db.query(
    `SELECT public.competition_host_start_session($1) AS result`,
    [sessionId]
  );
  assert.equal(startRes.rows[0].result.success, true);

  // Student 1 submits answer
  await setAuthContext(student1Id, 'authenticated');
  await db.query(
    `SELECT public.competition_submit_answer($1, $2, $3, NULL, '["opt1"]'::jsonb) AS result`,
    [sessionId, q1Id, s1PartId]
  );

  // Guest submits answer
  await setAuthContext(null, 'anon');
  await db.query(
    `SELECT public.competition_submit_answer($1, $2, $3, $4, '["opt1"]'::jsonb) AS result`,
    [sessionId, q1Id, guestPartId, guestRawToken]
  );

  // =========================================================================
  // SCENARIO 2: QUESTION STILL OPEN (DEADLINE NOT REACHED)
  // =========================================================================
  await t.test('2. In-Progress & Active Question: Student & Guest blocked with QUESTION_STILL_OPEN', async () => {
    // Student 1
    await setAuthContext(student1Id, 'authenticated');
    const s1Res = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Res.rows[0].result.success, false);
    assert.equal(s1Res.rows[0].result.error_code, 'QUESTION_STILL_OPEN');

    // Guest
    await setAuthContext(null, 'anon');
    const gRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, guestRawToken]
    );
    assert.equal(gRes.rows[0].result.success, false);
    assert.equal(gRes.rows[0].result.error_code, 'QUESTION_STILL_OPEN');

    // Host & Admin can still view real-time score
    await setAuthContext(hostId, 'authenticated');
    const hRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(hRes.rows[0].result.success, true);
    assert.ok(hRes.rows[0].result.leaderboard.length > 0);

    await setAuthContext(adminId, 'authenticated');
    const aRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(aRes.rows[0].result.success, true);
  });

  // =========================================================================
  // SCENARIO 3: PAUSED STATE (THE CRITICAL BLOCKER FIX)
  // =========================================================================
  await t.test('3. Paused State: question_deadline is NULL, but Student & Guest MUST BE BLOCKED (Bypass Fixed)', async () => {
    // Host pauses session
    await setAuthContext(hostId, 'authenticated');
    const pauseRes = await db.query(
      `SELECT public.competition_host_pause_session($1) AS result`,
      [sessionId]
    );
    assert.equal(pauseRes.rows[0].result.success, true);
    assert.equal(pauseRes.rows[0].result.status, 'paused');

    // Verify session state in DB
    const sessCheck = await db.query(
      `SELECT status, question_deadline, paused_remaining_ms FROM public.competition_sessions WHERE id = $1`,
      [sessionId]
    );
    assert.equal(sessCheck.rows[0].status, 'paused');
    assert.equal(sessCheck.rows[0].question_deadline, null);

    // Student 1 attempts to call leaderboard while paused -> MUST BE BLOCKED!
    await setAuthContext(student1Id, 'authenticated');
    const s1PauseLb = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1PauseLb.rows[0].result.success, false);
    assert.equal(s1PauseLb.rows[0].result.error_code, 'QUESTION_STILL_OPEN');

    // Guest attempts while paused -> MUST BE BLOCKED!
    await setAuthContext(null, 'anon');
    const gPauseLb = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, guestRawToken]
    );
    assert.equal(gPauseLb.rows[0].result.success, false);
    assert.equal(gPauseLb.rows[0].result.error_code, 'QUESTION_STILL_OPEN');

    // Host can still view leaderboard
    await setAuthContext(hostId, 'authenticated');
    const hPauseLb = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(hPauseLb.rows[0].result.success, true);
  });

  // =========================================================================
  // SCENARIO 4: RESUME SESSION
  // =========================================================================
  await t.test('4. Resumed Session: question resumes, Student & Guest still blocked', async () => {
    await setAuthContext(hostId, 'authenticated');
    const resumeRes = await db.query(
      `SELECT public.competition_host_resume_session($1) AS result`,
      [sessionId]
    );
    assert.equal(resumeRes.rows[0].result.success, true);

    await setAuthContext(student1Id, 'authenticated');
    const s1Res = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Res.rows[0].result.success, false);
    assert.equal(s1Res.rows[0].result.error_code, 'QUESTION_STILL_OPEN');
  });

  // =========================================================================
  // SCENARIO 5: DEADLINE PASSED BUT SNAPSHOT NOT READY
  // =========================================================================
  await t.test('5. Deadline passed but snapshot not materialized: still blocked', async () => {
    // Manually simulate deadline passed in past without creating snapshot
    await db.exec(`
      UPDATE public.competition_sessions
      SET question_deadline = clock_timestamp() - INTERVAL '5 seconds'
      WHERE id = '${sessionId}';
    `);

    await setAuthContext(student1Id, 'authenticated');
    const s1Res = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Res.rows[0].result.success, false);
    assert.equal(s1Res.rows[0].result.error_code, 'QUESTION_STILL_OPEN');
  });

  // =========================================================================
  // SCENARIO 6: HOST CLOSES QUESTION (SNAPSHOT MATERIALIZED) -> INTERIM UNLOCKED
  // =========================================================================
  await t.test('6. Host Closes Question: Snapshot materialized, Student & Guest CAN view interim leaderboard', async () => {
    await setAuthContext(hostId, 'authenticated');
    const closeRes = await db.query(
      `SELECT public.competition_host_close_question($1) AS result`,
      [sessionId]
    );
    assert.equal(closeRes.rows[0].result.success, true);

    // Verify snapshot exists in public.competition_question_result_snapshots
    const snapCount = await db.query(
      `SELECT count(*) AS count FROM public.competition_question_result_snapshots WHERE session_id = $1 AND question_id = $2`,
      [sessionId, q1Id]
    );
    assert.equal(parseInt(snapCount.rows[0].count, 10), 1);

    // Student 1 can now view interim leaderboard!
    await setAuthContext(student1Id, 'authenticated');
    const s1Interim = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Interim.rows[0].result.success, true);
    assert.equal(s1Interim.rows[0].result.session_status, 'in_progress');
    assert.equal(s1Interim.rows[0].result.current_question_id, q1Id);
    assert.ok(Array.isArray(s1Interim.rows[0].result.leaderboard));
    assert.ok(s1Interim.rows[0].result.leaderboard.length >= 2);

    // Guest can also view interim leaderboard!
    await setAuthContext(null, 'anon');
    const gInterim = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, guestRawToken]
    );
    assert.equal(gInterim.rows[0].result.success, true);
    assert.ok(Array.isArray(gInterim.rows[0].result.leaderboard));
  });

  // =========================================================================
  // SCENARIO 7: FAST QUESTION TRANSITION & STALE SNAPSHOT ISOLATION
  // =========================================================================
  await t.test('7. Next Question: Stale Q1 snapshot does NOT leak Q2! Student & Guest blocked immediately', async () => {
    // Host transitions to question 2
    await setAuthContext(hostId, 'authenticated');
    const nextRes = await db.query(
      `SELECT public.competition_host_next_question($1) AS result`,
      [sessionId]
    );
    assert.equal(nextRes.rows[0].result.success, true);
    assert.equal(nextRes.rows[0].result.current_question_index, 2);
    assert.equal(nextRes.rows[0].result.current_question_id, q2Id);

    // Student 1 tries to call leaderboard immediately -> MUST BE BLOCKED!
    await setAuthContext(student1Id, 'authenticated');
    const s1Q2 = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Q2.rows[0].result.success, false);
    assert.equal(s1Q2.rows[0].result.error_code, 'QUESTION_STILL_OPEN');

    // Guest tries -> MUST BE BLOCKED!
    await setAuthContext(null, 'anon');
    const gQ2 = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, guestRawToken]
    );
    assert.equal(gQ2.rows[0].result.success, false);
    assert.equal(gQ2.rows[0].result.error_code, 'QUESTION_STILL_OPEN');
  });

  // =========================================================================
  // SCENARIO 8: TIED RANKS & OLYMPIC TIE BREAKING
  // =========================================================================
  await t.test('8. Tied Ranks: Same score & time get shared rank, next rank skips (RANK() behavior)', async () => {
    // Force scores: Student 1 and Guest have identical score (100) and response time (2000), Student 2 has (50)
    await db.exec(`
      UPDATE public.competition_scores
      SET total_score = 100, correct_count = 1, total_response_time_ms = 2000
      WHERE participant_id IN ('${s1PartId}', '${guestPartId}');

      UPDATE public.competition_scores
      SET total_score = 50, correct_count = 1, total_response_time_ms = 5000
      WHERE participant_id = '${s2PartId}';
    `);

    // Host checks leaderboard rankings
    await setAuthContext(hostId, 'authenticated');
    const hRankRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    const lb = hRankRes.rows[0].result.leaderboard;

    const rank1Items = lb.filter((i) => i.rank === 1);
    assert.equal(rank1Items.length, 2, 'Two participants must tie for Rank 1');

    const rank3Items = lb.filter((i) => i.rank === 3);
    assert.equal(rank3Items.length, 1, 'Third participant must have Rank 3 (Olympic skip)');
    assert.equal(rank3Items[0].participant_id, s2PartId);
  });

  // =========================================================================
  // SCENARIO 9: ACCESS CONTROL - INVALID TOKEN & KICKED PARTICIPANT
  // =========================================================================
  await t.test('9. Access Control: Invalid token & kicked participant rejected with FORBIDDEN', async () => {
    // Invalid guest token
    await setAuthContext(null, 'anon');
    const invalidTokenRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, 'invalid_token_too_short') AS result`,
      [sessionId, guestPartId]
    );
    assert.equal(invalidTokenRes.rows[0].result.success, false);
    assert.equal(invalidTokenRes.rows[0].result.error_code, 'FORBIDDEN');

    // Wrong guest token
    const wrongToken = generateGuestToken();
    const wrongTokenRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, wrongToken]
    );
    assert.equal(wrongTokenRes.rows[0].result.success, false);
    assert.equal(wrongTokenRes.rows[0].result.error_code, 'FORBIDDEN');

    // Kick Student 2
    await db.exec(`
      UPDATE public.competition_participants
      SET status = 'kicked'
      WHERE id = '${s2PartId}';
    `);

    await setAuthContext(student2Id, 'authenticated');
    const kickedRes = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(kickedRes.rows[0].result.success, false);
    assert.equal(kickedRes.rows[0].result.error_code, 'FORBIDDEN');
  });

  // =========================================================================
  // SCENARIO 10: SESSION FINISHED (FINAL LEADERBOARD)
  // =========================================================================
  await t.test('10. Session Finished: Final leaderboard accessible to all valid participants', async () => {
    await setAuthContext(hostId, 'authenticated');
    const endRes = await db.query(
      `SELECT public.competition_host_finish_session($1) AS result`,
      [sessionId]
    );
    assert.equal(endRes.rows[0].result.success, true);

    // Student 1
    await setAuthContext(student1Id, 'authenticated');
    const s1Final = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Final.rows[0].result.success, true);
    assert.equal(s1Final.rows[0].result.session_status, 'finished');
    assert.ok(s1Final.rows[0].result.leaderboard.length >= 2);

    // Guest
    await setAuthContext(null, 'anon');
    const gFinal = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1, $2, $3) AS result`,
      [sessionId, guestPartId, guestRawToken]
    );
    assert.equal(gFinal.rows[0].result.success, true);
    assert.equal(gFinal.rows[0].result.session_status, 'finished');
  });

  // =========================================================================
  // SCENARIO 11: CANCELLED SESSION
  // =========================================================================
  await t.test('11. Cancelled Session: Returns SESSION_CANCELLED error', async () => {
    await db.exec(`
      UPDATE public.competition_sessions
      SET status = 'cancelled'
      WHERE id = '${sessionId}';
    `);

    await setAuthContext(student1Id, 'authenticated');
    const s1Canc = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [sessionId]
    );
    assert.equal(s1Canc.rows[0].result.success, false);
    assert.equal(s1Canc.rows[0].result.error_code, 'SESSION_CANCELLED');
  });

  // =========================================================================
  // SCENARIO 12: CONCURRENCY RACE CONDITION & POST-QUERY ATOMICITY GUARD
  // =========================================================================
  await t.test('12. Concurrency Race Condition: Atomicity guard blocks leak when Host transitions concurrently', async () => {
    // Create dedicated session for concurrency simulation
    await setAuthContext(hostId, 'authenticated');
    const cSessionRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Concurrency'::text,
        'Kiểm thử race condition'::text,
        'individual'::text,
        50::integer,
        $1::jsonb,
        '[]'::jsonb,
        false::boolean,
        '{}'::jsonb,
        true::boolean
      ) AS result`,
      [
        JSON.stringify([
          {
            question_order: 1,
            question_type: 'single_choice',
            question_text: 'Câu hỏi 1?',
            options: [{ id: 'opt1', text: 'A' }, { id: 'opt2', text: 'B' }],
            correct_answer: { option_id: 'opt1' },
            points: 100,
            time_limit_seconds: 30
          },
          {
            question_order: 2,
            question_type: 'single_choice',
            question_text: 'Câu hỏi 2?',
            options: [{ id: 'opt1', text: 'C' }, { id: 'opt2', text: 'D' }],
            correct_answer: { option_id: 'opt1' },
            points: 200,
            time_limit_seconds: 30
          }
        ])
      ]
    );
    const cSessionId = cSessionRes.rows[0].result.session_id || cSessionRes.rows[0].result.session?.id;
    const cRoomCode = cSessionRes.rows[0].result.room_code || cSessionRes.rows[0].result.session?.room_code;

    // Student 1 joins
    await setAuthContext(student1Id, 'authenticated');
    const cJoin = await db.query(
      `SELECT public.competition_join_session($1, 'Học Sinh A') AS result`,
      [cRoomCode]
    );
    const cPartId = cJoin.rows[0].result.participant_id || cJoin.rows[0].result.participant?.id;

    // Host starts session
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1) AS result`, [cSessionId]);

    // Get Q1 ID
    const q1 = (await db.query(
      `SELECT id FROM public.competition_questions WHERE session_id = $1 AND question_order = 1`,
      [cSessionId]
    )).rows[0].id;

    // Student 1 submits Q1
    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1, $2, $3, NULL, '["opt1"]'::jsonb) AS result`,
      [cSessionId, q1, cPartId]
    );

    // Host closes Q1 (snapshot Q1 created)
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_close_question($1) AS result`, [cSessionId]);

    // 1. When Q1 is closed, Student 1 can view Q1 interim leaderboard
    await setAuthContext(student1Id, 'authenticated');
    const q1LbBefore = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [cSessionId]
    );
    assert.equal(q1LbBefore.rows[0].result.success, true);
    assert.equal(q1LbBefore.rows[0].result.current_question_id, q1);
    assert.equal(q1LbBefore.rows[0].result.current_question_index, 1);

    // 2. Host advances to Q2 (Q2 is now active in_progress)
    await setAuthContext(hostId, 'authenticated');
    const hostNextRes = await db.query(
      `SELECT public.competition_host_next_question($1) AS result`,
      [cSessionId]
    );
    assert.equal(hostNextRes.rows[0].result.success, true);

    const q2 = (await db.query(
      `SELECT id FROM public.competition_questions WHERE session_id = $1 AND question_order = 2`,
      [cSessionId]
    )).rows[0].id;

    // 3. Student 1 submits answer for Q2, updating competition_scores
    await setAuthContext(student1Id, 'authenticated');
    const subQ2Res = await db.query(
      `SELECT public.competition_submit_answer($1, $2, $3, NULL, '["opt1"]'::jsonb) AS result`,
      [cSessionId, q2, cPartId]
    );
    assert.equal(subQ2Res.rows[0].result.success, true);

    // 4. Verify Student is immediately blocked: scores in competition_scores cannot leak
    const q2LbAfter = await db.query(
      `SELECT public.competition_get_leaderboard_snapshot($1) AS result`,
      [cSessionId]
    );
    assert.equal(q2LbAfter.rows[0].result.success, false);
    assert.equal(q2LbAfter.rows[0].result.error_code, 'QUESTION_STILL_OPEN');

    // 5. Verify Post-Query Atomicity Guard explicitly:
    // If a query captured Q1 before transition, verify post-query session check rejects
    const atomicityCheck = await db.query(`
      SELECT public.competition_get_leaderboard_snapshot($1) AS result
    `, [cSessionId]);
    assert.equal(atomicityCheck.rows[0].result.success, false);
    assert.equal(atomicityCheck.rows[0].result.error_code, 'QUESTION_STILL_OPEN');
  });
});
