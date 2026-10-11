import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

console.log('================================================================================');
console.log('🧪 COMPETITION V1 R18 — REWARD V1 BACKEND SYSTEM TEST SUITE');
console.log('================================================================================\n');

let db;

async function setupDatabase() {
  db = new PGlite();

  // Baseline auth, schemas & extensions mocks
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS private;
    CREATE SCHEMA IF NOT EXISTS app_private;

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
      avatar_url TEXT DEFAULT NULL,
      total_stars INT NOT NULL DEFAULT 0,
      total_coins INT NOT NULL DEFAULT 0,
      grade_level INT DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION app_private.is_admin()
    RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID 
          AND role = 'admin'
      );
    $$;

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
    GRANT USAGE ON SCHEMA public, auth, extensions, private, app_private TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, authenticated, anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, auth TO postgres, authenticated, anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, extensions, public, private, app_private TO postgres, authenticated, anon;
  `);

  // Migration 10: Question Results (R2)
  const m10Path = path.resolve('supabase/migrations/20261004000002_competition_v1_question_results.sql');
  await db.exec(fs.readFileSync(m10Path, 'utf8'));

  // Migration 11: Post-Session Review (R5)
  const m11Path = path.resolve('supabase/migrations/20261006000001_competition_v1_post_session_review.sql');
  await db.exec(fs.readFileSync(m11Path, 'utf8'));

  // Migration 12: Host Historical Results & Snapshots (R12)
  const m12Path = path.resolve('supabase/migrations/20261008110000_competition_v1_host_historical_question_results.sql');
  await db.exec(fs.readFileSync(m12Path, 'utf8'));

  // Migration 13: R16-A Matching Backend
  const m13Path = path.resolve('supabase/migrations/20261011000001_competition_v1_r16a_matching_backend.sql');
  await db.exec(fs.readFileSync(m13Path, 'utf8'));

  // Migration 14: R17 Interim Leaderboard Security
  const m14Path = path.resolve('supabase/migrations/20261012000001_competition_v1_r17_interim_leaderboard_security.sql');
  await db.exec(fs.readFileSync(m14Path, 'utf8'));

  // Migration 15: R18 Reward V1 System (Target Under Test)
  const m15Path = path.resolve('supabase/migrations/20261013000001_competition_v1_r18_reward_system.sql');
  await db.exec(fs.readFileSync(m15Path, 'utf8'));

  // Production-accurate profiles table privileges:
  // authenticated and anon can SELECT, but CANNOT update total_stars or total_coins directly
  await db.exec(`
    REVOKE ALL ON TABLE public.profiles FROM anon, authenticated, PUBLIC;
    GRANT SELECT ON TABLE public.profiles TO authenticated, anon;
    GRANT UPDATE (full_name, avatar_url) ON TABLE public.profiles TO authenticated;
  `);
}


async function setAuthContext(userId = null, role = 'authenticated') {
  const dbRole = role === 'anon' ? 'anon' : role === 'postgres' ? 'postgres' : 'authenticated';
  await db.exec(`
    SET ROLE ${dbRole};
    SELECT set_config('request.jwt.claim.sub', '${userId ? userId : ''}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);
  `);
}


function generateGuestToken() {
  return crypto.randomBytes(32).toString('hex');
}

test('Competition V1 R18 - Reward System Backend Implementation', async (t) => {
  await setupDatabase();

  // Test Entities
  const hostId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const student1Id = crypto.randomUUID();
  const student2Id = crypto.randomUUID();
  const student3Id = crypto.randomUUID();
  const student4Id = crypto.randomUUID();
  const studentNoAnsId = crypto.randomUUID();

  // Initial Seed
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${hostId}', 'host@test.com'),
      ('${adminId}', 'admin@test.com'),
      ('${student1Id}', 's1@test.com'),
      ('${student2Id}', 's2@test.com'),
      ('${student3Id}', 's3@test.com'),
      ('${student4Id}', 's4@test.com'),
      ('${studentNoAnsId}', 'snoans@test.com');

    INSERT INTO public.profiles (id, role, full_name, total_stars) VALUES
      ('${hostId}', 'teacher', 'Thầy Giáo Host', 0),
      ('${adminId}', 'admin', 'Quản Trị Viên', 0),
      ('${student1Id}', 'student', 'Học Sinh Top 1', 10),
      ('${student2Id}', 'student', 'Học Sinh Top 2', 20),
      ('${student3Id}', 'student', 'Học Sinh Top 3', 30),
      ('${student4Id}', 'student', 'Học Sinh Top 4 Tham Gia', 40),
      ('${studentNoAnsId}', 'student', 'Học Sinh Không Nộp Bài', 50);
  `);

  const canonicalQuestions = JSON.stringify([
    {
      question_order: 1,
      question_text: 'Thủ đô của Việt Nam là gì?',
      question_type: 'single_choice',
      options: [
        { id: 'opt_a', text: 'Hà Nội' },
        { id: 'opt_b', text: 'TP. Hồ Chí Minh' }
      ],
      correct_answer: { option_id: 'opt_a' },
      points: 10.00,
      time_limit_seconds: 30
    },
    {
      question_order: 2,
      question_text: '2 + 2 = ?',
      question_type: 'single_choice',
      options: [
        { id: 'opt_1', text: '3' },
        { id: 'opt_2', text: '4' }
      ],
      correct_answer: { option_id: 'opt_2' },
      points: 10.00,
      time_limit_seconds: 30
    }
  ]);

  // =========================================================================
  // TC-1: Verify create_session sets reward_status = 'pending' when reward_enabled = true
  // =========================================================================
  await t.test('TC-1: competition_host_create_session sets reward_status = "pending" when reward_enabled = true', async () => {
    await setAuthContext(hostId, 'authenticated');

    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Có Thưởng'::text,
        'Mô tả'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );

    const data = createRes.rows[0].res;
    assert.equal(data.success, true);
    assert.equal(data.reward_enabled, true);
    assert.equal(data.reward_status, 'pending');

    const dbSession = await db.query(
      `SELECT reward_enabled, reward_status FROM public.competition_sessions WHERE id = $1`,
      [data.session_id]
    );
    assert.equal(dbSession.rows[0].reward_enabled, true);
    assert.equal(dbSession.rows[0].reward_status, 'pending');
  });

  // =========================================================================
  // TC-2: Verify create_session sets reward_status = 'not_applicable' when reward_enabled = false
  // =========================================================================
  await t.test('TC-2: competition_host_create_session sets reward_status = "not_applicable" when reward_enabled = false', async () => {
    await setAuthContext(hostId, 'authenticated');

    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Không Thưởng'::text,
        'Mô tả'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        false::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );

    const data = createRes.rows[0].res;
    assert.equal(data.success, true);
    assert.equal(data.reward_enabled, false);
    assert.equal(data.reward_status, 'not_applicable');

    const dbSession = await db.query(
      `SELECT reward_enabled, reward_status FROM public.competition_sessions WHERE id = $1`,
      [data.session_id]
    );
    assert.equal(dbSession.rows[0].reward_enabled, false);
    assert.equal(dbSession.rows[0].reward_status, 'not_applicable');
  });

  // =========================================================================
  // TC-3: End-to-End Tier Distribution (Top 1=15, Top 2=10, Top 3=5, Part=2)
  //       + Guest gets 0 stars (skipped_guest)
  //       + Participant with 0 answers gets 0 stars (skipped_no_submission)
  //       + Participant with wrong answers still eligible for rank award
  // =========================================================================
  await t.test('TC-3: Standard Session Reward Execution: Top 1 (15), Top 2 (10), Top 3 (5), Part (2), Guest (0), No Answers (0)', async () => {
    await setAuthContext(hostId, 'authenticated');

    // Create reward-enabled session
    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Trao Thưởng V1'::text,
        'Kiểm thử chi tiết trao giải'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;

    // Fetch Question IDs
    const qRows = await db.query(
      `SELECT id, question_order FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`,
      [sessionId]
    );
    const q1Id = qRows.rows[0].id;
    const q2Id = qRows.rows[1].id;

    // Join Student 1 (Top 1)
    await setAuthContext(student1Id, 'authenticated');
    const p1Res = await db.query(
      `SELECT public.competition_join_session($1::varchar, 'Học Sinh Top 1'::varchar) AS res`,
      [roomCode]
    );
    const p1Id = p1Res.rows[0].res.participant_id || p1Res.rows[0].res.participant?.id;

    // Join Student 2 (Top 2)
    await setAuthContext(student2Id, 'authenticated');
    const p2Res = await db.query(
      `SELECT public.competition_join_session($1::varchar, 'Học Sinh Top 2'::varchar) AS res`,
      [roomCode]
    );
    const p2Id = p2Res.rows[0].res.participant_id || p2Res.rows[0].res.participant?.id;

    // Join Student 3 (Top 3) - Will submit WRONG answer to prove answering wrong is still eligible!
    await setAuthContext(student3Id, 'authenticated');
    const p3Res = await db.query(
      `SELECT public.competition_join_session($1::varchar, 'Học Sinh Top 3 Sai Hết'::varchar) AS res`,
      [roomCode]
    );
    const p3Id = p3Res.rows[0].res.participant_id || p3Res.rows[0].res.participant?.id;

    // Join Student 4 (Rank 4 - Participation)
    await setAuthContext(student4Id, 'authenticated');
    const p4Res = await db.query(
      `SELECT public.competition_join_session($1::varchar, 'Học Sinh Top 4'::varchar) AS res`,
      [roomCode]
    );
    const p4Id = p4Res.rows[0].res.participant_id || p4Res.rows[0].res.participant?.id;

    // Join Student 5 (Enrolled but submits NO answers)
    await setAuthContext(studentNoAnsId, 'authenticated');
    const pNoAnsRes = await db.query(
      `SELECT public.competition_join_session($1::varchar, 'Học Sinh Không Nộp'::varchar) AS res`,
      [roomCode]
    );
    const pNoAnsId = pNoAnsRes.rows[0].res.participant_id || pNoAnsRes.rows[0].res.participant?.id;

    // Join Guest Player
    await setAuthContext(null, 'anon');
    const guestToken = generateGuestToken();
    const guestRes = await db.query(
      `SELECT public.competition_join_session($1::varchar, 'Khách Vãng Lai'::varchar, null::text, null::uuid, $2::text) AS res`,
      [roomCode, guestToken]
    );
    const guestParticipantId = guestRes.rows[0].res.participant_id || guestRes.rows[0].res.participant?.id;

    // Host starts session
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sessionId]);

    // Student 1 answers Q1 correctly
    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p1Id]
    );

    // Student 2 answers Q1 correctly
    await setAuthContext(student2Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p2Id]
    );

    // Guest answers Q1 correctly
    await setAuthContext(null, 'anon');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, $4::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, guestParticipantId, guestToken]
    );

    // Student 3 answers Q1 WRONGLY (opt_b) -> 0 pts, but submitted answer!
    await setAuthContext(student3Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_b"]'::jsonb, null::text)`,
      [sessionId, q1Id, p3Id]
    );

    // Student 4 answers Q1 WRONGLY (opt_b) -> 0 pts, but submitted answer!
    await setAuthContext(student4Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_b"]'::jsonb, null::text)`,
      [sessionId, q1Id, p4Id]
    );

    // Host closes Q1 and moves to Q2
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_next_question($1::uuid)`, [sessionId]);

    // Student 1 answers Q2 correctly (Total 20 pts -> Rank 1)
    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_2"]'::jsonb, null::text)`,
      [sessionId, q2Id, p1Id]
    );

    // Host finishes session
    await setAuthContext(hostId, 'authenticated');
    const finishRes = await db.query(
      `SELECT public.competition_host_finish_session($1::uuid) AS res`,
      [sessionId]
    );
    assert.equal(finishRes.rows[0].res.success, true);
    assert.equal(finishRes.rows[0].res.reward_applied, true);

    // Verify session state
    const sRow = await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sessionId]);
    assert.equal(sRow.rows[0].status, 'finished');
    assert.equal(sRow.rows[0].reward_status, 'completed');

    // Verify Reward Transactions in Ledger Table
    const txRows = await db.query(
      `SELECT participant_id, user_id, rank, reward_tier, stars_awarded, status 
       FROM public.competition_reward_transactions 
       WHERE session_id = $1 
       ORDER BY rank ASC, stars_awarded DESC`,
      [sessionId]
    );

    // Check Student 1: Rank 1 -> 15 stars awarded
    const tx1 = txRows.rows.find(r => r.participant_id === p1Id);
    assert.ok(tx1, 'Student 1 transaction exists');
    assert.equal(tx1.rank, 1);
    assert.equal(tx1.reward_tier, 'top1');
    assert.equal(tx1.stars_awarded, 15);
    assert.equal(tx1.status, 'awarded');

    // Check Student 2: Top 2 -> 10 stars
    const tx2 = txRows.rows.find(r => r.participant_id === p2Id);
    assert.ok(tx2, 'Student 2 transaction exists');
    assert.equal(tx2.reward_tier, 'top2');
    assert.equal(tx2.stars_awarded, 10);
    assert.equal(tx2.status, 'awarded');

    // Check Guest: Has score, but stars_awarded = 0, status = 'skipped_guest'
    const txGuest = txRows.rows.find(r => r.participant_id === guestParticipantId);
    assert.ok(txGuest, 'Guest transaction exists in ledger');
    assert.equal(txGuest.stars_awarded, 0);
    assert.equal(txGuest.status, 'skipped_guest');

    // Check Student 3: Answered wrongly, has rank -> gets valid tier/participation stars
    const tx3 = txRows.rows.find(r => r.participant_id === p3Id);
    assert.ok(tx3, 'Student 3 transaction exists');
    assert.equal(tx3.status, 'awarded');
    assert.ok(tx3.stars_awarded >= 2, 'Student 3 who answered wrongly gets valid tier/participation stars');

    // Check Student 4: Answered wrongly -> participation (2 stars)
    const tx4 = txRows.rows.find(r => r.participant_id === p4Id);
    assert.ok(tx4, 'Student 4 transaction exists');
    assert.equal(tx4.status, 'awarded');
    assert.equal(tx4.stars_awarded, 2);
    assert.equal(tx4.reward_tier, 'participation');

    // Check Student No Ans: 0 answers submitted -> 0 stars, tier 'none', status 'skipped_no_submission'
    const txNoAns = txRows.rows.find(r => r.participant_id === pNoAnsId);
    assert.ok(txNoAns, 'Student No Answer transaction exists');
    assert.equal(txNoAns.stars_awarded, 0);
    assert.equal(txNoAns.reward_tier, 'none');
    assert.equal(txNoAns.status, 'skipped_no_submission');

    // Check Profiles Balances:
    // Student 1: Initial 10 + 15 = 25
    const p1Profile = await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id]);
    assert.equal(p1Profile.rows[0].total_stars, 25);

    // Student 2: Initial 20 + 10 = 30
    const p2Profile = await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student2Id]);
    assert.equal(p2Profile.rows[0].total_stars, 30);

    // Student 4: Initial 40 + 2 = 42
    const p4Profile = await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student4Id]);
    assert.equal(p4Profile.rows[0].total_stars, 42);

    // Student No Ans: Initial 50 + 0 = 50 (Unchanged!)
    const pNoAnsProfile = await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [studentNoAnsId]);
    assert.equal(pNoAnsProfile.rows[0].total_stars, 50);
  });

  // =========================================================================
  // TC-4: Tied Top 1 (Both get 15 stars, 3rd gets 5 stars)
  // =========================================================================
  await t.test('TC-4: Tie-breaking behavior: Shared Rank 1 students both receive 15 stars', async () => {
    await setAuthContext(hostId, 'authenticated');

    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Đồng Hạng'::text,
        'Kiểm thử đồng hạng'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;

    const qRows = await db.query(
      `SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`,
      [sessionId]
    );
    const q1Id = qRows.rows[0].id;

    // Reset initial stars (performed under postgres role as authenticated is barred from direct total_stars update)
    await db.exec(`SET ROLE postgres; UPDATE public.profiles SET total_stars = 0 WHERE id IN ('${student1Id}', '${student2Id}', '${student3Id}');`);

    // Join Student 1 & Student 2 & Student 3
    await setAuthContext(student1Id, 'authenticated');
    const p1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [roomCode])).rows[0].res;
    const p1 = p1Res.participant?.id || p1Res.participant_id;

    await setAuthContext(student2Id, 'authenticated');
    const p2Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S2'::varchar) AS res`, [roomCode])).rows[0].res;
    const p2 = p2Res.participant?.id || p2Res.participant_id;

    await setAuthContext(student3Id, 'authenticated');
    const p3Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S3'::varchar) AS res`, [roomCode])).rows[0].res;
    const p3 = p3Res.participant?.id || p3Res.participant_id;

    // Start session
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sessionId]);

    // Student 1 & Student 2 both answer Q1 with EXACT SAME points and time
    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p1]
    );

    await setAuthContext(student2Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p2]
    );

    // Make both answers identical in created_at and scores identical in total_response_time_ms to force exact same tie
    await db.exec(`
      SET ROLE postgres;
      UPDATE public.competition_answers 
      SET created_at = '2026-10-13 10:00:01+00' 
      WHERE session_id = '${sessionId}' AND participant_id IN ('${p1}', '${p2}');
      UPDATE public.competition_scores
      SET total_response_time_ms = 1000
      WHERE session_id = '${sessionId}' AND participant_id IN ('${p1}', '${p2}');
    `);



    // Student 3 answers with wrong answer (0 pts) -> Rank 3
    await setAuthContext(student3Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_b"]'::jsonb, null::text)`,
      [sessionId, q1Id, p3]
    );

    // Finish session
    await setAuthContext(hostId, 'authenticated');
    const finishRes = await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sessionId]);
    assert.equal(finishRes.rows[0].res.success, true);

    // Check ranks in competition_scores
    const scoreRows = await db.query(
      `SELECT participant_id, rank, total_score FROM public.competition_scores WHERE session_id = $1 ORDER BY rank ASC`,
      [sessionId]
    );
    const s1Score = scoreRows.rows.find(r => r.participant_id === p1);
    const s2Score = scoreRows.rows.find(r => r.participant_id === p2);
    const s3Score = scoreRows.rows.find(r => r.participant_id === p3);

    assert.equal(s1Score.rank, 1, 'Student 1 is Rank 1');
    assert.equal(s2Score.rank, 1, 'Student 2 is Rank 1 (Tied)');
    assert.equal(s3Score.rank, 3, 'Student 3 is Rank 3 (1, 1, 3)');

    // Verify Reward Transactions in Ledger
    const txRows = await db.query(
      `SELECT participant_id, rank, reward_tier, stars_awarded FROM public.competition_reward_transactions WHERE session_id = $1`,
      [sessionId]
    );
    const tx1 = txRows.rows.find(r => r.participant_id === p1);
    const tx2 = txRows.rows.find(r => r.participant_id === p2);
    const tx3 = txRows.rows.find(r => r.participant_id === p3);

    assert.equal(tx1.stars_awarded, 15, 'Tied Student 1 receives 15 stars');
    assert.equal(tx2.stars_awarded, 15, 'Tied Student 2 receives 15 stars');
    assert.equal(tx3.stars_awarded, 5, 'Rank 3 Student receives 5 stars (Top 3)');

    // Verify Profile Balances
    const p1Bal = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    const p2Bal = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student2Id])).rows[0].total_stars;
    const p3Bal = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student3Id])).rows[0].total_stars;

    assert.equal(p1Bal, 15);
    assert.equal(p2Bal, 15);
    assert.equal(p3Bal, 5);
  });

  // =========================================================================
  // TC-5: Double finish & Retry Idempotency (Calling finish or apply twice doesn't double-award)
  // =========================================================================
  await t.test('TC-5: Idempotency Protection: Repeated finish / apply calls do NOT double-award stars', async () => {
    await setAuthContext(hostId, 'authenticated');

    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Idempotent'::text,
        'Kiểm thử chống lặp'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;

    const qRows = await db.query(`SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`, [sessionId]);
    const q1Id = qRows.rows[0].id;

    // Reset student1 stars
    await db.exec(`SET ROLE postgres; UPDATE public.profiles SET total_stars = 0 WHERE id = '${student1Id}';`);


    // Student 1 joins & answers
    await setAuthContext(student1Id, 'authenticated');
    const p1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [roomCode])).rows[0].res;
    const p1 = p1Res.participant?.id || p1Res.participant_id;

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sessionId]);

    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p1]
    );

    // Host finishes session 1st time
    await setAuthContext(hostId, 'authenticated');
    const firstFinish = await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sessionId]);
    assert.equal(firstFinish.rows[0].res.success, true);
    assert.equal(firstFinish.rows[0].res.reward_applied, true);

    const balAfterFirst = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(balAfterFirst, 15, 'Awarded 15 stars on first finish');

    // Host finishes session 2nd time (simulating double click or network retry)
    const secondFinish = await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sessionId]);
    assert.equal(secondFinish.rows[0].res.success, false);
    assert.equal(secondFinish.rows[0].res.error_code, 'SESSION_ALREADY_FINISHED');

    const balAfterSecond = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(balAfterSecond, 15, 'Stars balance remains 15, NOT 30');

    // Calling private.competition_apply_rewards_internal directly on finished session (as system / postgres)
    await db.exec(`SET ROLE postgres;`);
    const directApply = await db.query(`SELECT private.competition_apply_rewards_internal($1::uuid) AS res`, [sessionId]);
    assert.equal(directApply.rows[0].res.success, true);

    assert.equal(directApply.rows[0].res.applied, false);
    assert.equal(directApply.rows[0].res.reason, 'ALREADY_COMPLETED');

    const balAfterDirect = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(balAfterDirect, 15, 'Stars balance remains 15 after direct apply');
  });

  // =========================================================================
  // TC-6: Disabled Reward Session (reward_enabled = false) never distributes stars
  // =========================================================================
  await t.test('TC-6: Reward Disabled Session: No transactions created, stars remain intact', async () => {
    await setAuthContext(hostId, 'authenticated');

    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Tắt Thưởng'::text,
        'Kiểm thử tắt thưởng'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        false::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;

    const qRows = await db.query(`SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`, [sessionId]);
    const q1Id = qRows.rows[0].id;

    // Reset student1 stars to 100
    await db.exec(`SET ROLE postgres; UPDATE public.profiles SET total_stars = 100 WHERE id = '${student1Id}';`);


    // Student 1 joins & answers
    await setAuthContext(student1Id, 'authenticated');
    const p1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [roomCode])).rows[0].res;
    const p1 = p1Res.participant?.id || p1Res.participant_id;

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sessionId]);

    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p1]
    );

    // Host finishes session
    await setAuthContext(hostId, 'authenticated');
    const finishRes = await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sessionId]);
    assert.equal(finishRes.rows[0].res.success, true);
    assert.equal(finishRes.rows[0].res.reward_applied, false);

    // Verify 0 transactions in ledger
    const txCount = await db.query(`SELECT count(*)::int as count FROM public.competition_reward_transactions WHERE session_id = $1`, [sessionId]);
    assert.equal(txCount.rows[0].count, 0);

    // Verify session reward_status remains not_applicable
    const sRow = await db.query(`SELECT reward_status FROM public.competition_sessions WHERE id = $1`, [sessionId]);
    assert.equal(sRow.rows[0].reward_status, 'not_applicable');

    // Balance remains 100
    const bal = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(bal, 100);
  });

  // =========================================================================
  // TC-7: Grants Audit: has_table_privilege and has_column_privilege
  // =========================================================================
  await t.test('TC-7: Grants Audit: has_table_privilege and has_column_privilege verify least privilege', async () => {
    // 1. Check ledger table privileges for anon, authenticated, postgres
    const privRows = await db.query(`
      SELECT 
        has_table_privilege('anon', 'public.competition_reward_transactions', 'SELECT') AS anon_select,
        has_table_privilege('anon', 'public.competition_reward_transactions', 'INSERT') AS anon_insert,
        has_table_privilege('anon', 'public.competition_reward_transactions', 'UPDATE') AS anon_update,
        has_table_privilege('anon', 'public.competition_reward_transactions', 'DELETE') AS anon_delete,
        has_table_privilege('anon', 'public.competition_reward_transactions', 'TRUNCATE') AS anon_truncate,
        has_table_privilege('authenticated', 'public.competition_reward_transactions', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.competition_reward_transactions', 'INSERT') AS auth_insert,
        has_table_privilege('authenticated', 'public.competition_reward_transactions', 'UPDATE') AS auth_update,
        has_table_privilege('authenticated', 'public.competition_reward_transactions', 'DELETE') AS auth_delete,
        has_table_privilege('authenticated', 'public.competition_reward_transactions', 'TRUNCATE') AS auth_truncate
    `);
    const p = privRows.rows[0];
    assert.equal(p.anon_select, false, 'anon role cannot SELECT ledger');
    assert.equal(p.anon_insert, false, 'anon role cannot INSERT ledger');
    assert.equal(p.anon_update, false, 'anon role cannot UPDATE ledger');
    assert.equal(p.anon_delete, false, 'anon role cannot DELETE ledger');
    assert.equal(p.anon_truncate, false, 'anon role cannot TRUNCATE ledger');

    assert.equal(p.auth_select, true, 'authenticated role can SELECT ledger (filtered by RLS)');
    assert.equal(p.auth_insert, false, 'authenticated role CANNOT INSERT ledger');
    assert.equal(p.auth_update, false, 'authenticated role CANNOT UPDATE ledger');
    assert.equal(p.auth_delete, false, 'authenticated role CANNOT DELETE ledger');
    assert.equal(p.auth_truncate, false, 'authenticated role CANNOT TRUNCATE ledger');

    // 2. Check profiles column privileges (Production parity)
    const colPrivRows = await db.query(`
      SELECT 
        has_column_privilege('authenticated', 'public.profiles', 'total_stars', 'SELECT') AS auth_select_stars,
        has_column_privilege('authenticated', 'public.profiles', 'total_stars', 'UPDATE') AS auth_update_stars,
        has_column_privilege('anon', 'public.profiles', 'total_stars', 'SELECT') AS anon_select_stars,
        has_column_privilege('anon', 'public.profiles', 'total_stars', 'UPDATE') AS anon_update_stars,
        has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') AS auth_update_name
    `);
    const cp = colPrivRows.rows[0];
    assert.equal(cp.auth_select_stars, true, 'authenticated can SELECT total_stars');
    assert.equal(cp.auth_update_stars, false, 'authenticated CANNOT UPDATE total_stars directly (Production parity)');
    assert.equal(cp.anon_update_stars, false, 'anon CANNOT UPDATE total_stars');
    assert.equal(cp.auth_update_name, true, 'authenticated can update allowed columns like full_name');

    // 3. Direct UPDATE attempt on profiles.total_stars by authenticated student fails with 42501
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    try {
      await db.query(`UPDATE public.profiles SET total_stars = 9999 WHERE id = '${student1Id}'`);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Direct UPDATE on profiles.total_stars by authenticated role blocked with 42501 permission denied');
    }
    await db.exec(`SET ROLE postgres;`);
  });

  // =========================================================================
  // TC-8: Ledger Mutation Denial with VALID Foreign Keys
  // =========================================================================
  await t.test('TC-8: Ledger Mutation Denial: Client cannot INSERT/UPDATE/DELETE ledger even with valid FKs (Error 42501)', async () => {
    // 1. Create a session and participant to obtain 100% valid Foreign Keys
    await setAuthContext(hostId, 'authenticated');
    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường FK Valid'::text,
        'Kiểm thử FK hợp lệ'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const validSessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;

    await setAuthContext(student1Id, 'authenticated');
    const p1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [roomCode])).rows[0].res;
    const validPartId = p1Res.participant?.id || p1Res.participant_id;

    // 2. Direct INSERT attempt under authenticated role WITH 100% VALID FKs
    // Must fail specifically with 42501 (permission denied), NOT 23503 (foreign_key_violation)!
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    try {
      await db.query(`
        INSERT INTO public.competition_reward_transactions (
          session_id, participant_id, user_id, participant_display_name, session_room_code, session_title, rank, reward_tier, stars_awarded, status
        ) VALUES (
          '${validSessionId}', '${validPartId}', '${student1Id}', 'Student 1', '${roomCode}', 'Title', 1, 'top1', 9999, 'awarded'
        )
      `);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Direct INSERT with VALID FKs blocked strictly by 42501 permission denied, NOT FK error');
    }

    // 3. Direct UPDATE attempt under authenticated role
    try {
      await db.query(`UPDATE public.competition_reward_transactions SET stars_awarded = 9999 WHERE session_id = '${validSessionId}'`);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Direct UPDATE blocked strictly by 42501 permission denied');
    }

    // 4. Direct DELETE attempt under authenticated role
    try {
      await db.query(`DELETE FROM public.competition_reward_transactions WHERE session_id = '${validSessionId}'`);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Direct DELETE blocked strictly by 42501 permission denied');
    }

    await db.exec(`SET ROLE postgres;`);
  });

  // =========================================================================
  // TC-9: RLS Read Security on Ledger
  // =========================================================================
  await t.test('TC-9: RLS Read Policies: Student reads only own rows, Host reads session, Anon blocked', async () => {
    // 1. Check with Student 1 auth context under authenticated role
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    const student1View = await db.query(`SELECT user_id FROM public.competition_reward_transactions`);
    assert.ok(student1View.rows.length > 0, 'Student 1 can see their own transactions');
    for (const r of student1View.rows) {
      assert.equal(r.user_id, student1Id, 'Student only sees their own transactions via RLS');
    }

    // 2. Host view under authenticated role
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${hostId}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    const hostView = await db.query(`SELECT session_id FROM public.competition_reward_transactions`);
    assert.ok(hostView.rows.length > 0, 'Host can see transactions for sessions they hosted');

    // 3. Anon view under anon role (Blocked with 42501 because REVOKE ALL FROM anon)
    await db.exec(`
      SET ROLE anon;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
    `);
    try {
      await db.query(`SELECT session_id FROM public.competition_reward_transactions`);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Anon SELECT on ledger blocked with 42501 permission denied');
    }

    await db.exec(`SET ROLE postgres;`);
  });

  // =========================================================================
  // TC-10: Foreign Key Isolation (FK vs Privilege)
  // =========================================================================
  await t.test('TC-10: Foreign Key Isolation: Invalid composite FK blocked by 23503 foreign_key_violation under privileged role', async () => {
    // Run under postgres role (which has INSERT privilege) to isolate Foreign Key validation
    await db.exec(`SET ROLE postgres;`);
    try {
      await db.query(`
        INSERT INTO public.competition_reward_transactions (
          session_id, participant_id, user_id, participant_display_name, session_room_code, session_title, rank, reward_tier, stars_awarded, status
        ) VALUES (
          gen_random_uuid(), gen_random_uuid(), '${student1Id}', 'Ghost', 'ROOM', 'Title', 1, 'top1', 15, 'awarded'
        )
      `);
      assert.fail('Should have failed with 23503');
    } catch (err) {
      assert.equal(err.code, '23503', 'Invalid FK must fail specifically with 23503 (foreign_key_violation)');
    }
  });

  // =========================================================================
  // TC-11: RPC Privileges Enforcement
  // =========================================================================
  await t.test('TC-11: RPC Privileges: Direct invocation of internal reward RPC blocked with 42501 for Student and Anon', async () => {
    // 1. Authenticated student attempting to invoke private.competition_apply_rewards_internal
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    try {
      await db.query(`SELECT private.competition_apply_rewards_internal(gen_random_uuid())`);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Student direct RPC invocation blocked with 42501 permission denied');
    }

    // 2. Anon guest attempting to invoke private.competition_apply_rewards_internal
    await db.exec(`
      SET ROLE anon;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
    `);
    try {
      await db.query(`SELECT private.competition_apply_rewards_internal(gen_random_uuid())`);
      assert.fail('Should have failed with 42501');
    } catch (err) {
      assert.equal(err.code, '42501', 'Anon direct RPC invocation blocked with 42501 permission denied');
    }

    await db.exec(`SET ROLE postgres;`);
  });

  // =========================================================================
  // TC-12: Strict State Guard & Fail-Closed
  // =========================================================================
  await t.test('TC-12: Strict State Guard: Internal reward RPC is fail-closed when reward_status is not pending', async () => {
    // 1. Create session with rewards enabled
    await setAuthContext(hostId, 'authenticated');
    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường State Guard'::text,
        'Kiểm thử trạng thái'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;

    // 2. Test invalid reward_status = 'processing'
    await db.exec(`
      SET ROLE postgres;
      UPDATE public.competition_sessions SET reward_status = 'processing' WHERE id = '${sessionId}';
    `);
    const procRes = await db.query(`SELECT private.competition_apply_rewards_internal($1::uuid) AS res`, [sessionId]);
    assert.equal(procRes.rows[0].res.success, false, 'Must fail when reward_status is processing');
    assert.equal(procRes.rows[0].res.error_code, 'INVALID_REWARD_STATUS');
    assert.equal(procRes.rows[0].res.applied, false);

    // 3. Test invalid reward_status = 'failed'
    await db.exec(`UPDATE public.competition_sessions SET reward_status = 'failed' WHERE id = '${sessionId}';`);
    const failRes = await db.query(`SELECT private.competition_apply_rewards_internal($1::uuid) AS res`, [sessionId]);
    assert.equal(failRes.rows[0].res.success, false, 'Must fail when reward_status is failed');
    assert.equal(failRes.rows[0].res.error_code, 'INVALID_REWARD_STATUS');
    assert.equal(failRes.rows[0].res.applied, false);

    // 4. Test invalid reward_status = 'not_applicable' when reward_enabled = true
    await db.exec(`UPDATE public.competition_sessions SET reward_status = 'not_applicable' WHERE id = '${sessionId}';`);
    const naRes = await db.query(`SELECT private.competition_apply_rewards_internal($1::uuid) AS res`, [sessionId]);
    assert.equal(naRes.rows[0].res.success, false, 'Must fail when reward_status is not_applicable');
    assert.equal(naRes.rows[0].res.error_code, 'INVALID_REWARD_STATUS');

    // 5. Verify zero rows written to ledger throughout
    const txCount = await db.query(`SELECT count(*)::int as count FROM public.competition_reward_transactions WHERE session_id = $1`, [sessionId]);
    assert.equal(txCount.rows[0].count, 0, 'No reward transactions can be written under invalid status');
  });

  // =========================================================================
  // TC-13: Transaction Rollback: Database failure aborts reward and rolls back state
  // =========================================================================
  await t.test('TC-13: Transaction Rollback: Database failure aborts reward and rolls back state', async () => {
    await setAuthContext(hostId, 'authenticated');
    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Rollback'::text,
        'Kiểm thử rollback'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;
    const q1Id = (await db.query(`SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`, [sessionId])).rows[0].id;

    // Student 1 joins & answers
    await setAuthContext(student1Id, 'authenticated');
    const p1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [roomCode])).rows[0].res;
    const p1 = p1Res.participant?.id || p1Res.participant_id;

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sessionId]);

    await setAuthContext(student1Id, 'authenticated');
    await db.query(
      `SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`,
      [sessionId, q1Id, p1]
    );

    // Initial student1 balance
    const initialBal = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;

    // Inject temporary failure trigger on profiles update
    await db.exec(`
      SET ROLE postgres;
      CREATE OR REPLACE FUNCTION public.fail_profile_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.total_stars > 10000 THEN
          RAISE EXCEPTION 'SIMULATED_PROFILE_UPDATE_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS trg_fail_profile_update ON public.profiles;
      CREATE TRIGGER trg_fail_profile_update
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.fail_profile_update();
      UPDATE public.profiles SET total_stars = 10000 WHERE id = '${student1Id}';
    `);

    // Host finishes session -> Must fail and rollback
    await setAuthContext(hostId, 'authenticated');
    let finishThrew = false;
    try {
      await db.query(`SELECT public.competition_host_finish_session($1::uuid)`, [sessionId]);
    } catch (err) {
      finishThrew = true;
      assert.match(err.message, /SIMULATED_PROFILE_UPDATE_FAILURE/);
    }
    assert.ok(finishThrew, 'Transaction must throw and abort when profile update fails');

    // VERIFY ROLLBACK:
    // 1. Session reward_status must NOT be 'completed'
    const sRow = await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sessionId]);
    assert.notEqual(sRow.rows[0].reward_status, 'completed', 'reward_status must NOT be completed after rollback');

    // 2. Zero reward transactions recorded for this session in ledger
    const txRows = await db.query(`SELECT count(*)::int as count FROM public.competition_reward_transactions WHERE session_id = $1`, [sessionId]);
    assert.equal(txRows.rows[0].count, 0, 'No reward transaction row must exist in ledger after rollback');

    // 3. Profiles total_stars must remain rolled back at 10000
    const rolledBackBal = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(rolledBackBal, 10000, 'Student profile stars balance must remain unmutated after rollback');

    // Cleanup trigger and restore balance
    await db.exec(`
      SET ROLE postgres;
      DROP TRIGGER IF EXISTS trg_fail_profile_update ON public.profiles;
      DROP FUNCTION IF EXISTS public.fail_profile_update();
      UPDATE public.profiles SET total_stars = ${initialBal} WHERE id = '${student1Id}';
    `);
  });

  // =========================================================================
  // TC-14: Multi-Session Progression: Sequential rewards across multiple sessions aggregate stars correctly
  // =========================================================================
  await t.test('TC-14: Multi-Session Progression: Sequential rewards across multiple sessions aggregate stars correctly', async () => {
    // Reset student1 stars
    await db.exec(`SET ROLE postgres; UPDATE public.profiles SET total_stars = 10 WHERE id = '${student1Id}';`);

    // Session 1: Student 1 wins Top 1 (15 stars) -> 10 + 15 = 25
    await setAuthContext(hostId, 'authenticated');
    const s1Res = await db.query(
      `SELECT public.competition_host_create_session(
        'Phiên 1'::text, 'Phiên 1'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sid1 = s1Res.rows[0].res.session_id;
    const rcode1 = s1Res.rows[0].res.room_code;
    const q1Id = (await db.query(`SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`, [sid1])).rows[0].id;

    await setAuthContext(student1Id, 'authenticated');
    const part1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [rcode1])).rows[0].res;
    const part1 = part1Res.participant?.id || part1Res.participant_id;

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sid1]);

    await setAuthContext(student1Id, 'authenticated');
    await db.query(`SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`, [sid1, q1Id, part1]);

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_finish_session($1::uuid)`, [sid1]);

    const bal1 = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(bal1, 25, 'Balance after session 1 is 10 + 15 = 25');

    // Session 2: Student 1 joins with Student 2. Student 2 answers first (Rank 1, 15 stars), Student 1 answers wrong (Rank 2, 10 stars) -> 25 + 10 = 35
    const s2Res = await db.query(
      `SELECT public.competition_host_create_session(
        'Phiên 2'::text, 'Phiên 2'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sid2 = s2Res.rows[0].res.session_id;
    const rcode2 = s2Res.rows[0].res.room_code;
    const qRows2 = await db.query(`SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`, [sid2]);
    const q2_1 = qRows2.rows[0].id;

    await setAuthContext(student2Id, 'authenticated');
    const part2_2 = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S2'::varchar) AS res`, [rcode2])).rows[0].res;
    const p2_2 = part2_2.participant?.id || part2_2.participant_id;

    await setAuthContext(student1Id, 'authenticated');
    const part2_1 = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [rcode2])).rows[0].res;
    const p2_1 = part2_1.participant?.id || part2_1.participant_id;

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sid2]);

    // Student 2 answers Q1 correctly
    await setAuthContext(student2Id, 'authenticated');
    await db.query(`SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`, [sid2, q2_1, p2_2]);

    // Student 1 answers Q1 wrong
    await setAuthContext(student1Id, 'authenticated');
    await db.query(`SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_b"]'::jsonb, null::text)`, [sid2, q2_1, p2_1]);

    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_finish_session($1::uuid)`, [sid2]);

    // Student 2 was Rank 1 (15 stars), Student 1 was Rank 2 (10 stars)
    const finalBal1 = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = $1`, [student1Id])).rows[0].total_stars;
    assert.equal(finalBal1, 35, 'Balance after session 2 is 25 + 10 = 35 (Sequential multi-session aggregation correct)');
  });

  // =========================================================================
  // TC-15: Final Leaderboard Snapshot RPC matches reward tier rank and scores
  // =========================================================================
  await t.test('TC-15: Final Leaderboard Snapshot RPC matches reward tier rank and scores', async () => {
    await setAuthContext(hostId, 'authenticated');

    // Create session
    const createRes = await db.query(
      `SELECT public.competition_host_create_session(
        'Đấu Trường Kiểm Tra Leaderboard'::text,
        'Kiểm tra snapshot'::text,
        'individual'::text,
        50::int,
        $1::jsonb,
        '[]'::jsonb,
        true::boolean,
        '{}'::jsonb,
        false::boolean
      ) AS res`,
      [canonicalQuestions]
    );
    const sessionObj = createRes.rows[0].res;
    const sessionId = sessionObj.session_id;
    const roomCode = sessionObj.room_code;
    const q1Id = (await db.query(`SELECT id FROM public.competition_questions WHERE session_id = $1 ORDER BY question_order ASC`, [sessionId])).rows[0].id;

    // Student 1 & 2 join
    await setAuthContext(student1Id, 'authenticated');
    const p1Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S1'::varchar) AS res`, [roomCode])).rows[0].res;
    const p1 = p1Res.participant?.id || p1Res.participant_id;

    await setAuthContext(student2Id, 'authenticated');
    const p2Res = (await db.query(`SELECT public.competition_join_session($1::varchar, 'S2'::varchar) AS res`, [roomCode])).rows[0].res;
    const p2 = p2Res.participant?.id || p2Res.participant_id;

    // Start & submit
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sessionId]);

    await setAuthContext(student1Id, 'authenticated');
    await db.query(`SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`, [sessionId, q1Id, p1]);

    await setAuthContext(student2Id, 'authenticated');
    await db.query(`SELECT public.competition_submit_answer($1::uuid, $2::uuid, $3::uuid, null::text, '["opt_a"]'::jsonb, null::text)`, [sessionId, q1Id, p2]);

    // Finish
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_finish_session($1::uuid)`, [sessionId]);

    // Read leaderboard snapshot via public RPC
    await setAuthContext(student1Id, 'authenticated');
    const lbRes = await db.query(`SELECT public.competition_get_leaderboard_snapshot($1::uuid, $2::uuid, null::text) AS res`, [sessionId, p1]);
    assert.equal(lbRes.rows[0].res.success, true);
    const leaderboard = lbRes.rows[0].res.leaderboard;

    assert.equal(leaderboard.length, 2);
    assert.equal(leaderboard[0].participant_id, p1);
    assert.equal(leaderboard[0].rank, 1);
    assert.equal(leaderboard[1].participant_id, p2);
    assert.equal(leaderboard[1].rank, 2);
  });

  // =========================================================================
  // TC-16: Host Finish Session State Consistency: Comprehensive guard across pending, completed, processing, failed, and not_applicable
  // =========================================================================
  await t.test('TC-16: Host Finish Session State Consistency: Comprehensive guard across pending, completed, processing, failed, and not_applicable', async () => {
    // 1. STATE: 'processing' when reward_enabled = true
    // Expected: Fail-closed (INVALID_REWARD_STATUS), session status remains 'in_progress', NOT 'finished'
    await setAuthContext(hostId, 'authenticated');
    const sProc = (await db.query(
      `SELECT public.competition_host_create_session(
        'Phòng Processing'::text, 'Test'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    )).rows[0].res;
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sProc.session_id]);
    await db.exec(`SET ROLE postgres; UPDATE public.competition_sessions SET reward_status = 'processing' WHERE id = '${sProc.session_id}';`);

    await setAuthContext(hostId, 'authenticated');
    const procFinishRes = (await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sProc.session_id])).rows[0].res;
    assert.equal(procFinishRes.success, false, 'Cannot finish session when reward_status is processing');
    assert.equal(procFinishRes.error_code, 'INVALID_REWARD_STATUS');
    const procDbStatus = (await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sProc.session_id])).rows[0];
    assert.equal(procDbStatus.status, 'in_progress', 'Session status must NOT be updated to finished');
    assert.equal(procDbStatus.reward_status, 'processing');

    // 2. STATE: 'failed' when reward_enabled = true
    // Expected: Fail-closed (INVALID_REWARD_STATUS), session status remains 'in_progress'
    const sFail = (await db.query(
      `SELECT public.competition_host_create_session(
        'Phòng Failed'::text, 'Test'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    )).rows[0].res;
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sFail.session_id]);
    await db.exec(`SET ROLE postgres; UPDATE public.competition_sessions SET reward_status = 'failed' WHERE id = '${sFail.session_id}';`);

    await setAuthContext(hostId, 'authenticated');
    const failFinishRes = (await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sFail.session_id])).rows[0].res;
    assert.equal(failFinishRes.success, false, 'Cannot finish session when reward_status is failed');
    assert.equal(failFinishRes.error_code, 'INVALID_REWARD_STATUS');
    const failDbStatus = (await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sFail.session_id])).rows[0];
    assert.equal(failDbStatus.status, 'in_progress', 'Session status must NOT be updated to finished');
    assert.equal(failDbStatus.reward_status, 'failed');

    // 3. STATE: 'not_applicable' when reward_enabled = true (Legacy / Inconsistent Room)
    // Expected: Fail-closed (INVALID_REWARD_STATUS), session status remains 'in_progress', rewards NOT omitted silently
    const sLegacy = (await db.query(
      `SELECT public.competition_host_create_session(
        'Phòng Cũ Không Nhất Quán'::text, 'Test'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    )).rows[0].res;
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sLegacy.session_id]);
    await db.exec(`SET ROLE postgres; UPDATE public.competition_sessions SET reward_status = 'not_applicable' WHERE id = '${sLegacy.session_id}';`);

    await setAuthContext(hostId, 'authenticated');
    const legacyFinishRes = (await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sLegacy.session_id])).rows[0].res;
    assert.equal(legacyFinishRes.success, false, 'Cannot finish session with reward_enabled=true but reward_status=not_applicable');
    assert.equal(legacyFinishRes.error_code, 'INVALID_REWARD_STATUS');
    const legacyDbStatus = (await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sLegacy.session_id])).rows[0];
    assert.equal(legacyDbStatus.status, 'in_progress', 'Legacy session must NOT finish without valid reward status');
    assert.equal(legacyDbStatus.reward_status, 'not_applicable');

    // 4. STATE: 'completed' when reward_enabled = true (Idempotent completion path)
    // Expected: Succeeds, session transitions to finished, reward_applied = false (already applied)
    const sComp = (await db.query(
      `SELECT public.competition_host_create_session(
        'Phòng Completed'::text, 'Test'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    )).rows[0].res;
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sComp.session_id]);
    await db.exec(`SET ROLE postgres; UPDATE public.competition_sessions SET reward_status = 'completed' WHERE id = '${sComp.session_id}';`);

    await setAuthContext(hostId, 'authenticated');
    const compFinishRes = (await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sComp.session_id])).rows[0].res;
    assert.equal(compFinishRes.success, true, 'Finish succeeds when rewards are already completed');
    assert.equal(compFinishRes.status, 'finished');
    assert.equal(compFinishRes.reward_applied, false, 'No new rewards applied');
    const compDbStatus = (await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sComp.session_id])).rows[0];
    assert.equal(compDbStatus.status, 'finished');
    assert.equal(compDbStatus.reward_status, 'completed');

    // 5. STATE: 'pending' when reward_enabled = true (Standard Happy Path)
    // Expected: Succeeds, session transitions to finished, reward_applied = true, reward_status = completed
    const sPending = (await db.query(
      `SELECT public.competition_host_create_session(
        'Phòng Pending'::text, 'Test'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, true::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    )).rows[0].res;
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sPending.session_id]);

    const pendingFinishRes = (await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sPending.session_id])).rows[0].res;
    assert.equal(pendingFinishRes.success, true, 'Finish succeeds when reward_status is pending');
    assert.equal(pendingFinishRes.status, 'finished');
    assert.equal(pendingFinishRes.reward_applied, true, 'Rewards applied successfully');
    const pendingDbStatus = (await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sPending.session_id])).rows[0];
    assert.equal(pendingDbStatus.status, 'finished');
    assert.equal(pendingDbStatus.reward_status, 'completed');

    // 6. STATE: 'not_applicable' when reward_enabled = false (Normal Non-Reward Session)
    // Expected: Succeeds, session transitions to finished, reward_applied = false, reward_status remains not_applicable
    const sDisabled = (await db.query(
      `SELECT public.competition_host_create_session(
        'Phòng Tắt Thưởng'::text, 'Test'::text, 'individual'::text, 50::int, $1::jsonb, '[]'::jsonb, false::boolean, '{}'::jsonb, false::boolean
      ) AS res`,
      [canonicalQuestions]
    )).rows[0].res;
    await db.query(`SELECT public.competition_host_start_session($1::uuid)`, [sDisabled.session_id]);

    const disabledFinishRes = (await db.query(`SELECT public.competition_host_finish_session($1::uuid) AS res`, [sDisabled.session_id])).rows[0].res;
    assert.equal(disabledFinishRes.success, true, 'Finish succeeds when rewards are disabled');
    assert.equal(disabledFinishRes.status, 'finished');
    assert.equal(disabledFinishRes.reward_applied, false);
    const disabledDbStatus = (await db.query(`SELECT status, reward_status FROM public.competition_sessions WHERE id = $1`, [sDisabled.session_id])).rows[0];
    assert.equal(disabledDbStatus.status, 'finished');
    assert.equal(disabledDbStatus.reward_status, 'not_applicable');
  });
});




