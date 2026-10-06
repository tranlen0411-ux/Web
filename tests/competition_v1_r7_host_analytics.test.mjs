import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  getHostQuestionAnalytics,
  isValidSessionUUID
} from '../src/services/competitionClient.js';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 R7 HOST QUESTION ANALYTICS TEST SUITE');
console.log('================================================================================\n');

async function runR7TestSuite() {
  const testResults = [];
  let testIndex = 0;

  function recordPass(desc) {
    testIndex++;
    testResults.push({ id: testIndex, desc, status: 'PASS' });
    console.log(`  ✅ [${testIndex}] PASS: ${desc}`);
  }

  // Read Source Files for Static Analysis
  const migration12Path = path.resolve('supabase/migrations/20261007000001_competition_v1_host_question_analytics.sql');
  const migration12Sql = fs.readFileSync(migration12Path, 'utf8');
  const clientLibSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');
  const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
  const analyticsViewSource = fs.readFileSync('src/components/competition/HostQuestionAnalyticsView.jsx', 'utf8');
  const studentReviewViewSource = fs.readFileSync('src/components/competition/StudentQuestionReviewView.jsx', 'utf8');

  // ============================================================================
  // DATABASE CATALOG & LOGIC TEST HARNESS VIA PGLITE
  // ============================================================================
  const db = new PGlite();

  // Setup Base Postgres Auth Mocks & Schemas
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE OR REPLACE FUNCTION extensions.digest(data bytea, type text)
    RETURNS bytea LANGUAGE plpgsql AS $$
    BEGIN
      RETURN sha256(data);
    END;
    $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS private;
    CREATE SCHEMA IF NOT EXISTS realtime;

    CREATE TABLE IF NOT EXISTS realtime.messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      topic TEXT,
      extension TEXT,
      inserted_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION realtime.topic()
    RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT ''::TEXT;
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'student',
      full_name TEXT NOT NULL DEFAULT 'Test User',
      avatar_url TEXT
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$;
  `);

  // Apply prerequisite baseline migrations (1, 2, 7, 10, 11)
  const migration1Sql = fs.readFileSync('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql', 'utf8');
  await db.exec(migration1Sql);

  const migration2Sql = fs.readFileSync('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql', 'utf8');
  await db.exec(migration2Sql);

  const migration7Sql = fs.readFileSync('supabase/migrations/20261003000001_competition_v1_active_question_snapshot_rpc.sql', 'utf8');
  await db.exec(migration7Sql);

  const migration10Sql = fs.readFileSync('supabase/migrations/20261004000002_competition_v1_question_results.sql', 'utf8');
  await db.exec(migration10Sql);

  const migration11Sql = fs.readFileSync('supabase/migrations/20261006000001_competition_v1_post_session_review.sql', 'utf8');
  await db.exec(migration11Sql);

  // Apply Migration 12 (R7 Host Analytics)
  await db.exec(migration12Sql);

  // Helper to set auth session context in Postgres
  async function setAuthContext(userId, role = 'authenticated') {
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
      await db.exec(`SET request.jwt.claim.role = '${role}';`);
    } else {
      await db.exec(`SET request.jwt.claim.sub = '';`);
      await db.exec(`SET request.jwt.claim.role = 'anon';`);
    }
  }

  // ============================================================================
  // TEST SECTION 1: MIGRATION & SECURITY DEFINITIONS
  // ============================================================================
  console.log('--- Test Section 1: Migration Contract & Security Invariants ---');

  // Test 1: Migration 12 exists and is additive
  assert.ok(fs.existsSync(migration12Path), 'Migration 12 file must exist');
  assert.ok(migration12Sql.includes('BEGIN;'), 'Migration 12 must use transactional BEGIN');
  assert.ok(migration12Sql.includes('COMMIT;'), 'Migration 12 must end with COMMIT');
  assert.ok(!migration12Sql.toLowerCase().includes('drop table'), 'Must not drop tables');
  assert.ok(!migration12Sql.toLowerCase().includes('alter table public.competition_'), 'Must not alter existing competition tables');
  recordPass('Migration 12 exists and is additive');

  // Test 2: Private helper SECURITY DEFINER
  assert.ok(
    migration12Sql.includes('CREATE OR REPLACE FUNCTION private.competition_host_get_question_analytics_internal'),
    'Defines private helper'
  );
  assert.ok(
    migration12Sql.includes('SECURITY DEFINER') && migration12Sql.includes("SET search_path = ''"),
    'Private helper is SECURITY DEFINER with search_path empty'
  );
  recordPass('Private helper SECURITY DEFINER with search_path = empty');

  // Test 3: Public wrapper SECURITY INVOKER
  assert.ok(
    migration12Sql.includes('CREATE OR REPLACE FUNCTION public.competition_host_get_question_analytics'),
    'Defines public wrapper'
  );
  assert.ok(
    migration12Sql.includes('SECURITY INVOKER') && migration12Sql.includes("SET search_path = ''"),
    'Public wrapper is SECURITY INVOKER with search_path empty'
  );
  recordPass('Public wrapper SECURITY INVOKER with search_path = empty');

  // ============================================================================
  // TEST SECTION 2: ACCESS GATES & AUTHORIZATION
  // ============================================================================
  console.log('\n--- Test Section 2: Authorization & Security Gates ---');

  // Seed Users: Host, Admin, Student, Other Host
  const hostId = '11111111-1111-4111-8111-111111111111';
  const otherHostId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const studentUserId = '44444444-4444-4444-8444-444444444444';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${hostId}', 'host@example.com'),
      ('${otherHostId}', 'otherhost@example.com'),
      ('${adminId}', 'admin@example.com'),
      ('${studentUserId}', 'student@example.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${hostId}', 'teacher', 'Teacher Host'),
      ('${otherHostId}', 'teacher', 'Other Teacher'),
      ('${adminId}', 'admin', 'Super Admin'),
      ('${studentUserId}', 'student', 'Student One')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed Test Sessions: 1 finished session, 1 in_progress session
  const finishedSessionId = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const activeSessionId = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  await db.exec(`
    INSERT INTO public.competition_sessions (
      id, host_id, title, room_code, status, mode, max_participants, review_enabled
    ) VALUES 
      ('${finishedSessionId}', '${hostId}', 'Finished Session 1', 'R70001', 'finished', 'individual', 50, true),
      ('${activeSessionId}', '${hostId}', 'Active Session 1', 'R70002', 'in_progress', 'individual', 50, true)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Test 4: auth.uid null denied
  await setAuthContext(null);
  const unauthRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  assert.equal(unauthRes.rows[0].res.success, false);
  assert.equal(unauthRes.rows[0].res.error_code, 'UNAUTHENTICATED');
  recordPass('auth.uid null denied with UNAUTHENTICATED');

  // Test 5: session not found denied
  await setAuthContext(hostId);
  const notFoundRes = await db.query(`SELECT public.competition_host_get_question_analytics('99999999-9999-4999-8999-999999999999') AS res`);
  assert.equal(notFoundRes.rows[0].res.success, false);
  assert.equal(notFoundRes.rows[0].res.error_code, 'SESSION_NOT_FOUND');
  recordPass('session not found denied with SESSION_NOT_FOUND');

  // Test 6: other host denied
  await setAuthContext(otherHostId);
  const forbiddenRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  assert.equal(forbiddenRes.rows[0].res.success, false);
  assert.equal(forbiddenRes.rows[0].res.error_code, 'FORBIDDEN');
  recordPass('other host denied with FORBIDDEN');

  // Test 7: admin allowed
  await setAuthContext(adminId);
  const adminRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  assert.equal(adminRes.rows[0].res.success, true);
  recordPass('admin role allowed to view analytics');

  // Test 8: student denied
  await setAuthContext(studentUserId);
  const studentRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  assert.equal(studentRes.rows[0].res.success, false);
  assert.equal(studentRes.rows[0].res.error_code, 'FORBIDDEN');
  recordPass('student denied with FORBIDDEN');

  // Test 9: guest/anon denied
  await setAuthContext(null, 'anon');
  const anonRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  assert.equal(anonRes.rows[0].res.success, false);
  assert.equal(anonRes.rows[0].res.error_code, 'UNAUTHENTICATED');
  recordPass('guest/anon denied with UNAUTHENTICATED');

  // Test 10: active session returns SESSION_NOT_FINISHED
  await setAuthContext(hostId);
  const notFinishedRes = await db.query(`SELECT public.competition_host_get_question_analytics('${activeSessionId}') AS res`);
  assert.equal(notFinishedRes.rows[0].res.success, false);
  assert.equal(notFinishedRes.rows[0].res.error_code, 'SESSION_NOT_FINISHED');
  recordPass('active session returns SESSION_NOT_FINISHED');

  // Test 11: finished host session allowed
  await setAuthContext(hostId);
  const hostAllowedRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  assert.equal(hostAllowedRes.rows[0].res.success, true);
  recordPass('finished host session allowed');

  // ============================================================================
  // TEST SECTION 3: ROSTER & PARTICIPANT SEMANTICS (OPTION A)
  // ============================================================================
  console.log('\n--- Test Section 3: Option A Final Session Roster Semantics ---');

  // Seed Questions for finishedSessionId:
  // Q1: single_choice (A, B, C, D)
  // Q2: true_false (True, False)
  // Q3: multiple_choice (A, B, C, D)
  // Q4: short_answer (acceptable: ["hanoi"])
  const q1Id = '11110001-1111-4111-8111-111111111111';
  const q2Id = '22220002-2222-4222-8222-222222222222';
  const q3Id = '33330003-3333-4333-8333-333333333333';
  const q4Id = '44440004-4444-4444-8444-444444444444';

  await db.exec(`
    INSERT INTO public.competition_questions (
      id, session_id, question_order, question_type, question_text, points, time_limit_seconds, options, correct_answer
    ) VALUES 
      ('${q1Id}', '${finishedSessionId}', 1, 'single_choice', 'Thủ đô VN là gì?', 10.0, 30, 
       '[{"id":"opt_1","text":"Hà Nội"},{"id":"opt_2","text":"TP.HCM"},{"id":"opt_3","text":"Đà Nẵng"},{"id":"opt_4","text":"Huế"}]'::jsonb,
       '{"option_id":"opt_1"}'::jsonb),
      ('${q2Id}', '${finishedSessionId}', 2, 'true_false', 'Mặt trời mọc ở hướng đông?', 10.0, 20,
       '[{"id":"true","text":"Đúng"},{"id":"false","text":"Sai"}]'::jsonb,
       '{"option_id":"true"}'::jsonb),
      ('${q3Id}', '${finishedSessionId}', 3, 'multiple_choice', 'Chọn các số nguyên tố?', 10.0, 30,
       '[{"id":"opt_a","text":"2"},{"id":"opt_b","text":"3"},{"id":"opt_c","text":"4"},{"id":"opt_d","text":"5"}]'::jsonb,
       '{"option_ids":["opt_a","opt_b","opt_d"]}'::jsonb),
      ('${q4Id}', '${finishedSessionId}', 4, 'short_answer', 'Viết tên thủ đô VN không dấu?', 10.0, 30,
       '[]'::jsonb,
       '{"acceptable_texts":["hanoi"]}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed Participants:
  // P1: active (joined early)
  // P2: active (joined early)
  // P3: active (joined late)
  // P4: kicked
  const p1Id = '1111000a-1111-4111-8111-111111111111';
  const p2Id = '2222000b-2222-4222-8222-222222222222';
  const p3Id = '3333000c-3333-4333-8333-333333333333';
  const p4KickedId = '4444000d-4444-4444-8444-444444444444';

  await db.exec(`
    INSERT INTO public.competition_participants (
      id, session_id, user_id, guest_token_hash, is_guest, display_name, status, joined_at
    ) VALUES
      ('${p1Id}', '${finishedSessionId}', '${studentUserId}', NULL, false, 'Student 1', 'active', now() - interval '10 minutes'),
      ('${p2Id}', '${finishedSessionId}', NULL, 'guest_hash_2222', true, 'Guest 2', 'active', now() - interval '10 minutes'),
      ('${p3Id}', '${finishedSessionId}', NULL, 'guest_hash_3333', true, 'Late Student 3', 'active', now() - interval '1 minute'),
      ('${p4KickedId}', '${finishedSessionId}', NULL, 'guest_hash_4444', true, 'Kicked Student 4', 'kicked', now() - interval '10 minutes')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed Answers:
  // Q1 (single_choice):
  //   P1: correct opt_1 (10 pts, 5000ms)
  //   P2: incorrect opt_2 (0 pts, 10000ms)
  //   P3: did not answer (joined late -> counted as unanswered)
  //   P4 (kicked): answered opt_1 (should be excluded)
  // Q2 (true_false):
  //   P1: correct true (10 pts, 3000ms)
  //   P2: correct true (10 pts, 4000ms)
  //   P3: incorrect false (0 pts, 6000ms)
  // Q3 (multiple_choice):
  //   P1: correct ["opt_a", "opt_b", "opt_d"] (10 pts, 8000ms)
  //   P2: partial/incorrect ["opt_a", "opt_c"] (0 pts, 9000ms)
  //   P3: unanswered
  // Q4 (short_answer):
  //   P1: correct "hanoi" (10 pts, 4000ms)
  //   P2: unanswered
  //   P3: unanswered

  await db.exec(`
    INSERT INTO public.competition_answers (
      id, session_id, question_id, participant_id, is_correct, points_awarded, time_taken_ms, selected_option_ids, text_answer
    ) VALUES
      (gen_random_uuid(), '${finishedSessionId}', '${q1Id}', '${p1Id}', true, 10.0, 5000, '["opt_1"]'::jsonb, null),
      (gen_random_uuid(), '${finishedSessionId}', '${q1Id}', '${p2Id}', false, 0.0, 10000, '["opt_2"]'::jsonb, null),
      (gen_random_uuid(), '${finishedSessionId}', '${q1Id}', '${p4KickedId}', true, 10.0, 2000, '["opt_1"]'::jsonb, null),

      (gen_random_uuid(), '${finishedSessionId}', '${q2Id}', '${p1Id}', true, 10.0, 3000, '["true"]'::jsonb, null),
      (gen_random_uuid(), '${finishedSessionId}', '${q2Id}', '${p2Id}', true, 10.0, 4000, '["true"]'::jsonb, null),
      (gen_random_uuid(), '${finishedSessionId}', '${q2Id}', '${p3Id}', false, 0.0, 6000, '["false"]'::jsonb, null),

      (gen_random_uuid(), '${finishedSessionId}', '${q3Id}', '${p1Id}', true, 10.0, 8000, '["opt_a","opt_b","opt_d"]'::jsonb, null),
      (gen_random_uuid(), '${finishedSessionId}', '${q3Id}', '${p2Id}', false, 0.0, 9000, '["opt_a","opt_c"]'::jsonb, null),

      (gen_random_uuid(), '${finishedSessionId}', '${q4Id}', '${p1Id}', true, 10.0, 4000, '[]'::jsonb, 'hanoi')
    ON CONFLICT DO NOTHING;
  `);

  await setAuthContext(hostId);
  const analyticsRes = await db.query(`SELECT public.competition_host_get_question_analytics('${finishedSessionId}') AS res`);
  const data = analyticsRes.rows[0].res;

  // Test 12: kicked participant excluded from final roster
  // 3 active + 1 kicked = 3 final_roster_count
  assert.equal(data.summary.final_roster_count, 3, 'Final roster count must be 3 (excluding kicked)');
  recordPass('kicked participant excluded from final roster (final_roster_count = 3)');

  // Test 13: late join participant remains part of final roster Option A
  assert.equal(data.questions[0].final_roster_count, 3, 'Late participant is included in final roster');
  recordPass('late join participant remains part of final roster Option A');

  // Test 14: late join participant can contribute unanswered to earlier question
  assert.equal(data.questions[0].unanswered_count, 1, 'Q1 has 1 unanswered (from late participant P3)');
  recordPass('late join participant contributes to unanswered count on earlier questions');

  // Test 15: answered_count exact
  assert.equal(data.questions[0].answered_count, 2, 'Q1 has 2 answered rows');
  assert.equal(data.questions[1].answered_count, 3, 'Q2 has 3 answered rows');
  recordPass('answered_count is exact for all questions');

  // Test 16: unanswered_count exact
  assert.equal(data.questions[0].unanswered_count, 1, 'Q1 unanswered = 3 - 2 = 1');
  assert.equal(data.questions[1].unanswered_count, 0, 'Q2 unanswered = 3 - 3 = 0');
  assert.equal(data.questions[2].unanswered_count, 1, 'Q3 unanswered = 3 - 2 = 1');
  assert.equal(data.questions[3].unanswered_count, 2, 'Q4 unanswered = 3 - 1 = 2');
  recordPass('unanswered_count is exact');

  // Test 17: correct_count exact
  assert.equal(data.questions[0].correct_count, 1, 'Q1 correct count = 1');
  assert.equal(data.questions[1].correct_count, 2, 'Q2 correct count = 2');
  assert.equal(data.questions[2].correct_count, 1, 'Q3 correct count = 1');
  assert.equal(data.questions[3].correct_count, 1, 'Q4 correct count = 1');
  recordPass('correct_count is exact');

  // Test 18: incorrect_count exact
  assert.equal(data.questions[0].incorrect_count, 1, 'Q1 incorrect count = 1');
  assert.equal(data.questions[1].incorrect_count, 1, 'Q2 incorrect count = 1');
  assert.equal(data.questions[2].incorrect_count, 1, 'Q3 incorrect count = 1');
  assert.equal(data.questions[3].incorrect_count, 0, 'Q4 incorrect count = 0');
  recordPass('incorrect_count is exact');

  // Test 19: accuracy denominator = final_roster_count
  // Q1: 1 correct / 3 roster = 33.33%
  assert.equal(Number(data.questions[0].accuracy_percent), 33.33);
  // Q2: 2 correct / 3 roster = 66.67%
  assert.equal(Number(data.questions[1].accuracy_percent), 66.67);
  recordPass('accuracy denominator = final_roster_count (33.33% and 66.67%)');

  // ============================================================================
  // TEST SECTION 4: EDGE CASES (ZERO ROSTER, ZERO ANSWERS)
  // ============================================================================
  console.log('\n--- Test Section 4: Edge Cases (Zero Roster & Zero Answers) ---');

  const emptySessionId = 'cccc3333-cccc-4ccc-8ccc-cccccccccccc';
  await db.exec(`
    INSERT INTO public.competition_sessions (
      id, host_id, title, room_code, status, mode, max_participants
    ) VALUES 
      ('${emptySessionId}', '${hostId}', 'Empty Session', 'R70003', 'finished', 'individual', 50)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.competition_questions (
      id, session_id, question_order, question_type, question_text, points, time_limit_seconds, options, correct_answer
    ) VALUES 
      (gen_random_uuid(), '${emptySessionId}', 1, 'single_choice', 'Câu hỏi rỗng?', 10.0, 30, 
       '[{"id":"opt_1","text":"A"},{"id":"opt_2","text":"B"}]'::jsonb, '{"option_id":"opt_1"}'::jsonb)
    ON CONFLICT DO NOTHING;
  `);

  const emptyRes = await db.query(`SELECT public.competition_host_get_question_analytics('${emptySessionId}') AS res`);
  const emptyData = emptyRes.rows[0].res;

  // Test 20: zero roster safe
  assert.equal(emptyData.summary.final_roster_count, 0);
  assert.equal(Number(emptyData.summary.overall_accuracy_percent), 0);
  assert.equal(Number(emptyData.questions[0].accuracy_percent), 0);
  recordPass('zero roster safe (0 participants -> 0% accuracy without DB error)');

  // Test 21: zero answers safe
  assert.equal(emptyData.questions[0].answered_count, 0);
  assert.equal(Number(emptyData.questions[0].average_points), 0);
  assert.equal(Number(emptyData.questions[0].average_response_time_ms), 0);
  recordPass('zero answers safe (0 answers -> 0 average points / 0 response time)');

  // Test 22: average points uses answered rows
  // Q1 has 2 answered: 10 + 0 = avg 5.00
  assert.equal(Number(data.questions[0].average_points), 5.00);
  // Q2 has 3 answered: 10 + 10 + 0 = avg 6.67
  assert.equal(Number(data.questions[1].average_points), 6.67);
  recordPass('average points calculated over answered rows only');

  // Test 23: average response time uses answered rows
  // Q1 has 2 answered: (5000 + 10000) / 2 = 7500ms
  assert.equal(Number(data.questions[0].average_response_time_ms), 7500);
  // Q2 has 3 answered: (3000 + 4000 + 6000) / 3 = 4333ms
  assert.equal(Number(data.questions[1].average_response_time_ms), 4333);
  recordPass('average response time calculated over answered rows only');

  // ============================================================================
  // TEST SECTION 5: OPTION DISTRIBUTION & PRIVACY
  // ============================================================================
  console.log('\n--- Test Section 5: Option Distribution & Strict Privacy ---');

  // Test 24: single-choice distribution exact
  const q1Dist = data.questions[0].option_distribution;
  assert.equal(q1Dist.length, 4);
  const q1Opt1 = q1Dist.find(o => o.option_id === 'opt_1');
  const q1Opt2 = q1Dist.find(o => o.option_id === 'opt_2');
  assert.equal(q1Opt1.selection_count, 1);
  assert.equal(Number(q1Opt1.selection_percent), 50.0);
  assert.equal(q1Opt1.is_correct || q1Opt1.is_correct_option, true);
  assert.equal(q1Opt2.selection_count, 1);
  assert.equal(Number(q1Opt2.selection_percent), 50.0);
  assert.equal(q1Opt2.is_correct || q1Opt2.is_correct_option, false);
  recordPass('single-choice distribution exact');

  // Test 25: true/false distribution exact
  const q2Dist = data.questions[1].option_distribution;
  assert.equal(q2Dist.length, 2);
  const q2True = q2Dist.find(o => o.option_id === 'true');
  const q2False = q2Dist.find(o => o.option_id === 'false');
  assert.equal(q2True.selection_count, 2);
  assert.equal(Number(q2True.selection_percent), 66.67);
  assert.equal(q2False.selection_count, 1);
  assert.equal(Number(q2False.selection_percent), 33.33);
  recordPass('true/false distribution exact');

  // Test 26: multiple-choice participant can increment multiple options
  const q3Dist = data.questions[2].option_distribution;
  const q3OptA = q3Dist.find(o => o.option_id === 'opt_a');
  const q3OptB = q3Dist.find(o => o.option_id === 'opt_b');
  const q3OptC = q3Dist.find(o => o.option_id === 'opt_c');
  const q3OptD = q3Dist.find(o => o.option_id === 'opt_d');
  assert.equal(q3OptA.selection_count, 2); // P1 and P2 both selected opt_a
  assert.equal(q3OptB.selection_count, 1); // P1
  assert.equal(q3OptC.selection_count, 1); // P2
  assert.equal(q3OptD.selection_count, 1); // P1
  recordPass('multiple-choice participant can increment multiple options');

  // Test 27: multiple-choice percentages may total >100%
  const totalQ3Percent = q3Dist.reduce((acc, curr) => acc + Number(curr.selection_percent), 0);
  assert.ok(totalQ3Percent > 100, `Total percentage is ${totalQ3Percent}% which is > 100%`);
  recordPass('multiple-choice percentages may total > 100% (valid multi-select behavior)');

  // Test 28: short_answer returns no raw text answers
  const q4Dist = data.questions[3].option_distribution;
  assert.deepEqual(q4Dist, []);
  assert.equal(data.questions[3].text_answer, undefined);
  recordPass('short_answer returns empty distribution and no text_answer field');

  // Test 29: no participant identity fields in payload
  const rawJson = JSON.stringify(data);
  assert.ok(!rawJson.includes('student@example.com'), 'No student email');
  assert.ok(!rawJson.includes('Student 1'), 'No student display name');
  assert.ok(!rawJson.includes('avatar_url'), 'No avatar url');
  assert.ok(!rawJson.includes('guest_token_hash'), 'No guest token hash');
  assert.ok(!rawJson.includes('participant_id'), 'No participant_id');
  recordPass('no participant identity fields in aggregate payload (Zero PII)');

  // Test 30: no raw selected_option_ids returned
  assert.ok(!rawJson.includes('"selected_option_ids"'), 'No raw selected_option_ids array');
  recordPass('no raw selected_option_ids returned in question rows');

  // ============================================================================
  // TEST SECTION 6: INSIGHTS (TOP HARDEST & TOP SLOWEST)
  // ============================================================================
  console.log('\n--- Test Section 6: Top Insights Sorting & Filtering ---');

  // Helper replica of Top Hardest sorting logic
  function getTopHardest(questions) {
    return [...questions]
      .filter(q => q.final_roster_count > 0)
      .sort((a, b) => {
        if (Number(a.accuracy_percent) !== Number(b.accuracy_percent)) {
          return Number(a.accuracy_percent) - Number(b.accuracy_percent);
        }
        if (Number(a.unanswered_count) !== Number(b.unanswered_count)) {
          return Number(b.unanswered_count) - Number(a.unanswered_count);
        }
        return Number(a.question_order) - Number(b.question_order);
      })
      .slice(0, 3);
  }

  // Helper replica of Top Slowest sorting logic
  function getTopSlowest(questions) {
    return [...questions]
      .filter(q => q.answered_count > 0)
      .sort((a, b) => {
        if (Number(a.average_response_time_ms) !== Number(b.average_response_time_ms)) {
          return Number(b.average_response_time_ms) - Number(a.average_response_time_ms);
        }
        return Number(a.question_order) - Number(b.question_order);
      })
      .slice(0, 3);
  }

  // Test 31: Top hardest sorting deterministic
  const hardest = getTopHardest(data.questions);
  assert.equal(hardest.length, 3);
  // Q4: 33.33% accuracy, 2 unanswered
  // Q1: 33.33% accuracy, 1 unanswered, order 1
  // Q3: 33.33% accuracy, 1 unanswered, order 3
  assert.equal(hardest[0].question_order, 4);
  assert.equal(hardest[1].question_order, 1);
  assert.equal(hardest[2].question_order, 3);
  recordPass('Top hardest sorting is deterministic (accuracy ASC, unanswered DESC, order ASC)');

  // Test 32: zero-answer question allowed in hardest
  const mixedQuestions = [
    { question_order: 1, final_roster_count: 5, answered_count: 0, accuracy_percent: 0, unanswered_count: 5, average_response_time_ms: 0 },
    { question_order: 2, final_roster_count: 5, answered_count: 5, accuracy_percent: 80, unanswered_count: 0, average_response_time_ms: 5000 }
  ];
  const hardestWithZero = getTopHardest(mixedQuestions);
  assert.equal(hardestWithZero[0].question_order, 1, 'Zero-answer question included in hardest');
  recordPass('zero-answer question is allowed in hardest');

  // Test 33: Top slowest sorting deterministic
  const slowest = getTopSlowest(data.questions);
  assert.equal(slowest.length, 3);
  // Q3: 8500ms
  // Q1: 7500ms
  // Q2: 4333ms
  assert.equal(slowest[0].question_order, 3);
  assert.equal(slowest[1].question_order, 1);
  assert.equal(slowest[2].question_order, 2);
  recordPass('Top slowest sorting is deterministic (average_response_time_ms DESC, order ASC)');

  // Test 34: zero-answer question excluded from slowest
  const slowestWithZero = getTopSlowest(mixedQuestions);
  assert.equal(slowestWithZero.length, 1);
  assert.equal(slowestWithZero[0].question_order, 2);
  recordPass('zero-answer question is strictly excluded from slowest');

  // ============================================================================
  // TEST SECTION 7: CLIENT, UI & RELOAD PRESERVATION
  // ============================================================================
  console.log('\n--- Test Section 7: Client, UI Integration & Storage Invariants ---');

  // Test 35: client calls only analytics RPC
  assert.ok(
    clientLibSource.includes('competition_host_get_question_analytics'),
    'competitionClient.js calls competition_host_get_question_analytics'
  );
  assert.ok(
    !clientLibSource.includes('from(\'competition_answers\')'),
    'competitionClient does not query competition_answers directly'
  );
  recordPass('client calls only authoritative analytics RPC');

  // Test 36: analytics payload not persisted to web storage
  assert.ok(
    !analyticsViewSource.includes('localStorage.setItem'),
    'HostQuestionAnalyticsView does not write to localStorage'
  );
  assert.ok(
    !analyticsViewSource.includes('sessionStorage.setItem'),
    'HostQuestionAnalyticsView does not write to sessionStorage'
  );
  recordPass('analytics payload is not persisted in web storage');

  // Test 37: Host analytics only rendered for finished session
  assert.ok(
    hostPageSource.includes("currentStatus === 'finished'"),
    'Host page checks for finished status'
  );
  assert.ok(
    hostPageSource.includes('<HostQuestionAnalyticsView'),
    'Host page renders HostQuestionAnalyticsView'
  );
  assert.ok(
    hostPageSource.includes("finishedTab === 'ANALYTICS'"),
    'Host page renders HostQuestionAnalyticsView only when finishedTab is ANALYTICS'
  );
  recordPass('Host analytics view rendered only for finished session under Analytics tab');

  // Test 38: R3 FINAL_RESULTS reload preserved
  assert.ok(
    hostPageSource.includes('HOST_SESSION_STORAGE_KEY'),
    'R3 host session storage key preserved'
  );
  assert.ok(
    hostPageSource.includes('getInitialActiveSessionId'),
    'R3 initial active session resolver preserved'
  );
  recordPass('R3 FINAL_RESULTS reload recovery preserved');

  // Test 39: R5 student review unchanged
  assert.ok(
    clientLibSource.includes('studentGetReview'),
    'studentGetReview client export preserved'
  );
  assert.ok(
    studentReviewViewSource.includes('reviewData'),
    'StudentQuestionReviewView preserved'
  );
  recordPass('R5 student review unchanged');

  // Test 40: R6 student review filters/navigation unchanged
  assert.ok(
    studentReviewViewSource.includes("'ALL'") &&
    studentReviewViewSource.includes("'CORRECT'") &&
    studentReviewViewSource.includes("'INCORRECT'") &&
    studentReviewViewSource.includes("'UNANSWERED'"),
    'R6 4 filters preserved'
  );
  recordPass('R6 student review filters and navigation unchanged');

  // Test 41: canonical leaderboard sorting unchanged
  assert.ok(
    migration2Sql.includes('s.total_score DESC') &&
    migration2Sql.includes('s.correct_count DESC') &&
    migration2Sql.includes('s.total_response_time_ms ASC'),
    'Canonical leaderboard ordering is total_score DESC, correct_count DESC, total_response_time_ms ASC'
  );
  recordPass('canonical leaderboard sorting unchanged');

  // Test 42: PostgreSQL RANK() semantics unchanged
  assert.ok(
    migration2Sql.includes('RANK() OVER ('),
    'Canonical leaderboard uses PostgreSQL RANK() semantics'
  );
  recordPass('PostgreSQL RANK() semantics unchanged');

  // ============================================================================
  // TEST SECTION 8: CLIENT HARDENING & STALE RESPONSE GUARDS
  // ============================================================================
  console.log('\n--- Test Section 8: Client Hardening & Stale Response Guards ---');

  // Test 43: Invalid session UUID is rejected before RPC invocation
  const malformedUuids = ['not-a-uuid', '', '12345', null, undefined, 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'];
  for (const badId of malformedUuids) {
    const res = await getHostQuestionAnalytics(badId);
    assert.equal(res.success, false, `Bad UUID ${badId} must fail locally`);
    assert.equal(res.error_code, 'INVALID_SESSION_ID', `Bad UUID ${badId} must return INVALID_SESSION_ID`);
  }
  recordPass('Invalid session UUID is rejected before RPC invocation');

  // Test 44: getHostQuestionAnalytics uses existing isValidSessionUUID helper
  assert.ok(
    clientLibSource.includes('!isValidSessionUUID(sessionId)'),
    'getHostQuestionAnalytics must call isValidSessionUUID(sessionId)'
  );
  assert.equal(isValidSessionUUID('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isValidSessionUUID('invalid-uuid'), false);
  assert.equal(isValidSessionUUID(''), false);
  assert.equal(isValidSessionUUID(null), false);
  recordPass('getHostQuestionAnalytics uses existing isValidSessionUUID helper');

  // Test 45: Analytics request has request identity / stale-response guard
  assert.ok(
    analyticsViewSource.includes('latestRequestIdRef'),
    'HostQuestionAnalyticsView must track latestRequestIdRef'
  );
  assert.ok(
    analyticsViewSource.includes('currentSessionIdRef'),
    'HostQuestionAnalyticsView must track currentSessionIdRef'
  );
  assert.ok(
    analyticsViewSource.includes('requestId !== latestRequestIdRef.current') ||
    analyticsViewSource.includes('requestSessionId !== currentSessionIdRef.current'),
    'HostQuestionAnalyticsView must verify request identity before mutating state'
  );
  assert.ok(
    analyticsViewSource.includes('setAnalyticsData(null)'),
    'HostQuestionAnalyticsView clears stale analyticsData on new fetch initiation'
  );
  recordPass('Analytics request has request identity / stale-response guard');

  // Test 46: Old session response cannot overwrite newer session analytics
  let latestRequestId = 0;
  let currentSessionId = '11111111-1111-4111-8111-111111111111';
  let activeState = null;

  async function mockHostAnalyticsFetch(targetSessionId, simulatedDelayMs, payload) {
    const reqId = ++latestRequestId;
    const reqSessionId = targetSessionId;

    await new Promise(r => setTimeout(r, simulatedDelayMs));

    if (reqId !== latestRequestId || reqSessionId !== currentSessionId) {
      return; // Drop stale response
    }
    activeState = payload;
  }

  // Session A request starts (takes 60ms)
  const reqA = mockHostAnalyticsFetch('11111111-1111-4111-8111-111111111111', 60, { session: 'A_OLD' });
  // Session switches to Session B, fast fetch starts (takes 10ms)
  currentSessionId = '22222222-2222-4222-8222-222222222222';
  const reqB = mockHostAnalyticsFetch('22222222-2222-4222-8222-222222222222', 10, { session: 'B_NEW' });

  await Promise.all([reqA, reqB]);
  assert.deepEqual(activeState, { session: 'B_NEW' }, 'Old session response A must not overwrite newer session B analytics');
  recordPass('Old session response cannot overwrite newer session analytics');

  // Test 47: Analytics payload remains absent from localStorage/sessionStorage
  assert.ok(
    !analyticsViewSource.includes('localStorage') &&
    !analyticsViewSource.includes('sessionStorage'),
    'HostQuestionAnalyticsView must not persist analytics payload in web storage'
  );
  assert.ok(
    !clientLibSource.includes('localStorage.setItem') ||
    !clientLibSource.includes('competition_host_get_question_analytics'),
    'competitionClient must not write analytics payload to localStorage'
  );
  recordPass('Analytics payload remains absent from localStorage/sessionStorage');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${testIndex} COMPETITION V1 R7 TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================================\n');
}

runR7TestSuite().catch(err => {
  console.error('\n❌ R7 TEST SUITE FAILED:', err);
  process.exit(1);
});
