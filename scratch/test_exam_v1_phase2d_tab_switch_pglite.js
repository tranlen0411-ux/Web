import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    passedTests++;
    console.log(`✅ PASS: [${totalTests}] ${message}`);
  }
}

async function assertRejects(fn, expectedCodeSubstring, message) {
  totalTests++;
  try {
    await fn();
    failedTests++;
    console.error(`❌ FAIL: Expected rejection containing "${expectedCodeSubstring}", but succeeded: ${message}`);
    throw new Error(`Expected rejection: ${message}`);
  } catch (err) {
    if (err.message && err.message.includes(expectedCodeSubstring)) {
      passedTests++;
      console.log(`✅ PASS: [${totalTests}] Expected error thrown: ${expectedCodeSubstring} - ${message}`);
    } else {
      failedTests++;
      console.error(`❌ FAIL: Expected error code "${expectedCodeSubstring}", got: "${err.message}" - ${message}`);
      throw err;
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 2D TAB-SWITCH AUDIT RPC TEST SUITE');
  console.log('====================================================\n');

  const db = new PGlite();

  // Setup Postgres environment & Supabase roles
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    $$;

    CREATE SCHEMA IF NOT EXISTS app_private;
  `);

  // Apply baseline migrations 1..6 and migration 7
  const migrationFiles = [
    '20260905000001_exam_builder_v1_phase1_schema.sql',
    '20260905000002_exam_builder_v1_phase1_1_grading_status.sql',
    '20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql',
    '20260905000004_exam_builder_v1_phase2b1_assignment_attempt_rpcs.sql',
    '20260905000005_exam_builder_v1_phase2b2_answer_submit_rpcs.sql',
    '20260905000006_exam_builder_v1_phase2c_manual_grading_rpc.sql',
    '20260905000007_exam_builder_v1_phase2d_tab_switch_audit_rpc.sql'
  ];

  for (let i = 0; i < migrationFiles.length; i++) {
    const f = migrationFiles[i];
    const sql = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', f), 'utf8');
    const t0 = Date.now();
    await db.exec(sql);
    console.log(`📦 Applied migration ${i + 1}/${migrationFiles.length}: ${f} (${Date.now() - t0}ms)`);
  }

  console.log('\n--- SETTING UP FIXTURES ---');

  const teacherId = '11111111-1111-4111-8111-111111111111';
  const student1Id = '22222222-2222-4222-8222-222222222201';
  const student2Id = '22222222-2222-4222-8222-222222222202';
  const student3Id = '22222222-2222-4222-8222-222222222203';
  const student4Id = '22222222-2222-4222-8222-222222222204';
  const student5Id = '22222222-2222-4222-8222-222222222205';

  const classId = '33333333-3333-4333-8333-333333333301';

  // Exam 1: Policy = 'OFF'
  const examOffId = '44444444-4444-4444-8444-444444444401';
  const verOffId = '55555555-5555-4555-8555-555555555501';
  const assignOffId = '66666666-6666-4666-8666-666666666601';
  const qOffId = '88888888-8888-4888-8888-888888888801';

  await db.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam OFF', 'MATH', 10);`, [teacherId, examOffId, verOffId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1::uuid, $2::uuid, 'Exam OFF', 'MATH', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'OFF', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    verOffId,
    JSON.stringify([{
      id: qOffId,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1+1=?',
      points: 10.0,
      options_json: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
      answer_key: { correct_answer: 'A' }
    }])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verOffId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignOffId, verOffId, classId]);

  // Exam 2: Policy = 'WARN_ONLY'
  const examWarnId = '44444444-4444-4444-8444-444444444402';
  const verWarnId = '55555555-5555-4555-8555-555555555502';
  const assignWarnId = '66666666-6666-4666-8666-666666666602';
  const qWarnId = '88888888-8888-4888-8888-888888888802';

  await db.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam WARN', 'MATH', 10);`, [teacherId, examWarnId, verWarnId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1::uuid, $2::uuid, 'Exam WARN', 'MATH', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'WARN_ONLY', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    verWarnId,
    JSON.stringify([{
      id: qWarnId,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '2+2=?',
      points: 10.0,
      options_json: [{ key: 'A', text: '4' }, { key: 'B', text: '5' }],
      answer_key: { correct_answer: 'A' }
    }])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verWarnId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignWarnId, verWarnId, classId]);

  // Exam 3: Policy = 'WARN_AND_LOG'
  const examLogId = '44444444-4444-4444-8444-444444444403';
  const verLogId = '55555555-5555-4555-8555-555555555503';
  const assignLogId = '66666666-6666-4666-8666-666666666603';
  const qLogId = '88888888-8888-4888-8888-888888888803';

  await db.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam LOG', 'MATH', 10);`, [teacherId, examLogId, verLogId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1::uuid, $2::uuid, 'Exam LOG', 'MATH', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    verLogId,
    JSON.stringify([{
      id: qLogId,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '3+3=?',
      points: 10.0,
      options_json: [{ key: 'A', text: '6' }, { key: 'B', text: '7' }],
      answer_key: { correct_answer: 'A' }
    }])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verLogId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignLogId, verLogId, classId]);

  console.log('✅ Fixtures created successfully.\n');

  console.log('--- SECTION 1: POLICY = OFF (TESTS 1 - 3) ---');
  // Start attempt for student1 on Exam OFF
  const attemptOffId = '77777777-7777-4777-8777-777777777701';
  await db.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student1Id, attemptOffId, assignOffId, student1Id]);

  // Test 1: OFF page_hidden -> no-op
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student1Id, attemptOffId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.attempt_id === attemptOffId, 'Test 1: OFF page_hidden returns attempt_id');
    assert(d.tab_switch_policy === 'OFF', 'Test 1: tab_switch_policy is OFF');
    assert(d.tab_switch_count === 0, 'Test 1: tab_switch_count remains 0');
    assert(d.active_leave_episode_id === null, 'Test 1: active_leave_episode_id is null');
    assert(d.event_recorded === false, 'Test 1: event_recorded is false');
    assert(d.idempotent_replay === false, 'Test 1: idempotent_replay is false');

    const auditCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptOffId]);
    assert(auditCount.rows[0].cnt === 0, 'Test 1: No audit event inserted into DB');
  }

  // Test 2: OFF page_visible -> no-op
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student1Id, attemptOffId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === false, 'Test 2: OFF page_visible event_recorded is false');
    assert(d.tab_switch_count === 0, 'Test 2: tab_switch_count remains 0');
    const auditCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptOffId]);
    assert(auditCount.rows[0].cnt === 0, 'Test 2: No audit event inserted into DB');
  }

  // Test 3: OFF window_blur -> no-op
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur');`, [student1Id, attemptOffId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === false, 'Test 3: OFF window_blur event_recorded is false');
    assert(d.tab_switch_count === 0, 'Test 3: tab_switch_count remains 0');
    const auditCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptOffId]);
    assert(auditCount.rows[0].cnt === 0, 'Test 3: No audit event inserted into DB');
  }

  console.log('\n--- SECTION 2: POLICY = WARN_ONLY (TESTS 4 - 6) ---');
  // Start attempt for student2 on Exam WARN_ONLY
  const attemptWarnId = '77777777-7777-4777-8777-777777777702';
  await db.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student2Id, attemptWarnId, assignWarnId, student2Id]);

  // Test 4: WARN_ONLY page_hidden -> no persistent mutation
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student2Id, attemptWarnId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.tab_switch_policy === 'WARN_ONLY', 'Test 4: tab_switch_policy is WARN_ONLY');
    assert(d.tab_switch_count === 0, 'Test 4: tab_switch_count remains 0');
    assert(d.active_leave_episode_id === null, 'Test 4: active_leave_episode_id is null');
    assert(d.event_recorded === false, 'Test 4: event_recorded is false');
    const auditCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptWarnId]);
    assert(auditCount.rows[0].cnt === 0, 'Test 4: No audit event inserted into DB');
  }

  // Test 5: WARN_ONLY page_visible -> no persistent mutation
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student2Id, attemptWarnId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === false, 'Test 5: WARN_ONLY page_visible event_recorded is false');
    assert(d.tab_switch_count === 0, 'Test 5: tab_switch_count remains 0');
    const auditCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptWarnId]);
    assert(auditCount.rows[0].cnt === 0, 'Test 5: No audit event inserted into DB');
  }

  // Test 6: WARN_ONLY window_blur -> no persistent mutation
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur');`, [student2Id, attemptWarnId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === false, 'Test 6: WARN_ONLY window_blur event_recorded is false');
    assert(d.tab_switch_count === 0, 'Test 6: tab_switch_count remains 0');
    const auditCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptWarnId]);
    assert(auditCount.rows[0].cnt === 0, 'Test 6: No audit event inserted into DB');
  }

  console.log('\n--- SECTION 3: POLICY = WARN_AND_LOG (TESTS 7 - 18) ---');
  // Start attempt for student3 on Exam WARN_AND_LOG
  const attemptLogId = '77777777-7777-4777-8777-777777777703';
  await db.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student3Id, attemptLogId, assignLogId, student3Id]);

  let activeEpId1 = null;

  // Test 7: WARN_AND_LOG page_hidden opens episode
  {
    const ts = new Date().toISOString();
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden', $3::timestamptz);`, [student3Id, attemptLogId, ts]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.tab_switch_policy === 'WARN_AND_LOG', 'Test 7: tab_switch_policy is WARN_AND_LOG');
    assert(d.event_recorded === true, 'Test 7: event_recorded is true');
    assert(d.event_type === 'episode_opened', 'Test 7: event_type is episode_opened');
    assert(d.idempotent_replay === false, 'Test 7: idempotent_replay is false');
    assert(d.tab_switch_count === 1, 'Test 8: page_hidden increments count once (count=1)');
    assert(d.active_leave_episode_id !== null, 'Test 9: active episode id set server-side');
    activeEpId1 = d.active_leave_episode_id;

    // Verify DB attempt row and audit row
    const attRow = await db.query(`SELECT tab_switch_count, active_leave_episode_id FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId]);
    assert(attRow.rows[0].tab_switch_count === 1, 'Test 8: DB exam_attempts.tab_switch_count is 1');
    assert(attRow.rows[0].active_leave_episode_id === activeEpId1, 'Test 9: DB exam_attempts.active_leave_episode_id matches');

    const auditRows = await db.query(`SELECT * FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptLogId]);
    assert(auditRows.rows.length === 1, 'Test 7: Exactly 1 audit event row inserted');
    assert(auditRows.rows[0].episode_id === activeEpId1, 'Test 7: Audit event episode_id matches active episode');
    assert(auditRows.rows[0].event_type === 'episode_opened', 'Test 7: Audit event event_type is episode_opened');
    assert(auditRows.rows[0].signal_source === 'page_hidden', 'Test 7: Audit event signal_source is page_hidden');
  }

  // Test 10: Duplicate page_hidden while episode is active -> no-op & idempotent replay
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === false, 'Test 10: duplicate page_hidden event_recorded is false');
    assert(d.event_type === 'episode_opened', 'Test 10: event_type is episode_opened');
    assert(d.idempotent_replay === true, 'Test 10: duplicate page_hidden idempotent_replay is true');
    assert(d.tab_switch_count === 1, 'Test 11: duplicate page_hidden count unchanged (count=1)');
    assert(d.active_leave_episode_id === activeEpId1, 'Test 10: active_leave_episode_id unchanged');

    const auditRows = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptLogId]);
    assert(auditRows.rows[0].cnt === 1, 'Test 10: No new audit row inserted (still 1)');
  }

  // Test 12: page_visible closes active episode
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student3Id, attemptLogId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === true, 'Test 12: page_visible event_recorded is true');
    assert(d.event_type === 'episode_closed', 'Test 12: event_type is episode_closed');
    assert(d.idempotent_replay === false, 'Test 12: idempotent_replay is false');
    assert(d.tab_switch_count === 1, 'Test 12: tab_switch_count remains 1');
    assert(d.active_leave_episode_id === null, 'Test 14: close clears active episode (null)');

    const attRow = await db.query(`SELECT tab_switch_count, active_leave_episode_id FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId]);
    assert(attRow.rows[0].tab_switch_count === 1, 'Test 12: DB tab_switch_count is 1');
    assert(attRow.rows[0].active_leave_episode_id === null, 'Test 14: DB active_leave_episode_id is null');

    const auditRows = await db.query(`SELECT * FROM public.exam_audit_events WHERE attempt_id = $1::uuid ORDER BY created_at ASC;`, [attemptLogId]);
    assert(auditRows.rows.length === 2, 'Test 12: Total 2 audit rows now');
    assert(auditRows.rows[1].event_type === 'episode_closed', 'Test 12: Second audit row is episode_closed');
    assert(auditRows.rows[1].episode_id === activeEpId1, 'Test 12: Closed episode_id matches original active episode');
    assert(auditRows.rows[1].signal_source === 'page_visible', 'Test 12: signal_source is page_visible');
  }

  // Test 15: Duplicate close (page_visible when active episode is null) -> no-op
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student3Id, attemptLogId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === false, 'Test 15: duplicate close event_recorded is false');
    assert(d.event_type === 'episode_closed', 'Test 15: event_type is episode_closed');
    assert(d.idempotent_replay === true, 'Test 15: idempotent_replay is true');
    assert(d.tab_switch_count === 1, 'Test 15: count remains 1');
    assert(d.active_leave_episode_id === null, 'Test 15: active episode remains null');

    const auditRows = await db.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptLogId]);
    assert(auditRows.rows[0].cnt === 2, 'Test 15: No new audit row inserted (still 2)');
  }

  // Test 13: window_focus closes active episode
  let activeEpId2 = null;
  {
    // Re-open episode with page_hidden
    const openRes = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
    const openData = openRes.rows[0].rpc_exam_record_integrity_event;
    assert(openData.event_recorded === true, 'Test 13 setup: second episode opened');
    assert(openData.tab_switch_count === 2, 'Test 13 setup: count incremented to 2');
    activeEpId2 = openData.active_leave_episode_id;
    assert(activeEpId2 !== activeEpId1, 'Test 13 setup: new episode has unique UUID');

    // Close with window_focus
    const closeRes = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_focus');`, [student3Id, attemptLogId]);
    const closeData = closeRes.rows[0].rpc_exam_record_integrity_event;
    assert(closeData.event_recorded === true, 'Test 13: window_focus closes active episode');
    assert(closeData.event_type === 'episode_closed', 'Test 13: event_type is episode_closed');
    assert(closeData.active_leave_episode_id === null, 'Test 13: active episode cleared');
    assert(closeData.tab_switch_count === 2, 'Test 13: count remains 2');

    const lastAudit = await db.query(`SELECT * FROM public.exam_audit_events WHERE attempt_id = $1::uuid ORDER BY created_at DESC LIMIT 1;`, [attemptLogId]);
    assert(lastAudit.rows[0].event_type === 'episode_closed', 'Test 13: audit row is episode_closed');
    assert(lastAudit.rows[0].signal_source === 'window_focus', 'Test 13: audit row signal_source is window_focus');
    assert(lastAudit.rows[0].episode_id === activeEpId2, 'Test 13: audit row closed episode_id matches');
  }

  // Test 16 - 18: window_blur inserts auxiliary event without changing count or active episode
  {
    const res = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur');`, [student3Id, attemptLogId]);
    const d = res.rows[0].rpc_exam_record_integrity_event;
    assert(d.event_recorded === true, 'Test 16: window_blur inserts auxiliary event');
    assert(d.event_type === 'focus_loss_auxiliary', 'Test 16: event_type is focus_loss_auxiliary');
    assert(d.idempotent_replay === false, 'Test 16: idempotent_replay is false');
    assert(d.tab_switch_count === 2, 'Test 17: window_blur count unchanged (count=2)');
    assert(d.active_leave_episode_id === null, 'Test 18: window_blur active episode unchanged (null)');

    const lastAudit = await db.query(`SELECT * FROM public.exam_audit_events WHERE attempt_id = $1::uuid ORDER BY created_at DESC LIMIT 1;`, [attemptLogId]);
    assert(lastAudit.rows[0].event_type === 'focus_loss_auxiliary', 'Test 16: DB row event_type is focus_loss_auxiliary');
    assert(lastAudit.rows[0].signal_source === 'window_blur', 'Test 16: DB row signal_source is window_blur');
    assert(lastAudit.rows[0].episode_id === null, 'Test 16: DB row episode_id is null');

    // Sequential window_blur events should all record cleanly
    const res2 = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur');`, [student3Id, attemptLogId]);
    assert(res2.rows[0].rpc_exam_record_integrity_event.event_recorded === true, 'Test 16b: second window_blur recorded');
  }

  console.log('\n--- SECTION 4: ERROR HANDLING & STATE GUARDS (TESTS 19 - 23) ---');
  // Test 19: wrong caller rejected
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student4Id, attemptLogId]),
    'ERR_STUDENT_IDENTITY_MISMATCH',
    'Test 19: Wrong caller rejected'
  );

  // Test 20: missing attempt rejected
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, '99999999-9999-4999-8999-999999999999'::uuid, 'page_hidden');`, [student3Id]),
    'ERR_ATTEMPT_NOT_FOUND',
    'Test 20: Missing attempt rejected'
  );

  // Setup student4 attempt for submission & grading tests
  const attId4 = '77777777-7777-4777-8777-777777777704';
  await db.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student4Id, attId4, assignLogId, student4Id]);

  // Answer question for attempt 4 and submit (version becomes 2)
  await db.query(`SELECT public.rpc_exam_save_answer($1::uuid, $2::uuid, $3::uuid, '"A"'::jsonb, NULL, 1);`, [student4Id, attId4, qLogId]);
  await db.query(`SELECT public.rpc_exam_submit_attempt($1::uuid, $2::uuid, 2);`, [student4Id, attId4]);

  // Test 21: finalized submitted rejected
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student4Id, attId4]),
    'ERR_ATTEMPT_NOT_DRAFT',
    'Test 21: Submitted attempt rejected'
  );

  // Setup student5 for pending_manual_grade and graded checks
  // Create mixed exam requiring manual grading
  const examMixedId = '44444444-4444-4444-8444-444444444405';
  const verMixedId = '55555555-5555-4555-8555-555555555505';
  const assignMixedId = '66666666-6666-4666-8666-666666666605';
  const qEssayMixedId = '88888888-8888-4888-8888-888888888805';

  await db.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam Mixed', 'LIT', 10);`, [teacherId, examMixedId, verMixedId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1::uuid, $2::uuid, 'Exam Mixed', 'LIT', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    verMixedId,
    JSON.stringify([{
      id: qEssayMixedId,
      question_number: 1,
      question_type: 'essay',
      prompt: 'Write essay:',
      points: 10.0,
      options_json: []
    }])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verMixedId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignMixedId, verMixedId, classId]);

  const attId5 = '77777777-7777-4777-8777-777777777705';
  await db.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student5Id, attId5, assignMixedId, student5Id]);
  await db.query(`SELECT public.rpc_exam_save_answer($1::uuid, $2::uuid, $3::uuid, '"My essay response"'::jsonb, NULL, 1);`, [student5Id, attId5, qEssayMixedId]);

  // Submit attempt 5 -> status becomes 'pending_manual_grade'
  await db.query(`SELECT public.rpc_exam_submit_attempt($1::uuid, $2::uuid, 2);`, [student5Id, attId5]);

  // Test 22: pending_manual_grade rejected
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student5Id, attId5]),
    'ERR_ATTEMPT_NOT_DRAFT',
    'Test 22: pending_manual_grade attempt rejected'
  );

  // Grade attempt 5 -> status becomes 'graded' (version 3 -> 4)
  await db.query(`
    SELECT public.rpc_exam_grade_manual_attempt(
      $1::uuid, $2::uuid, $3::jsonb, 'Well done!', 3
    );
  `, [
    teacherId,
    attId5,
    JSON.stringify([{
      exam_question_id: qEssayMixedId,
      points_earned: 9.0,
      teacher_comment: 'Good essay'
    }])
  ]);

  // Test 23: graded rejected
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student5Id, attId5]),
    'ERR_ATTEMPT_NOT_DRAFT',
    'Test 23: graded attempt rejected'
  );

  console.log('\n--- SECTION 5: NON-PUNITIVE INVARIANTS (TESTS 24 - 27) ---');
  // Verify draft attempt student3 before and after multiple integrity events
  const draftRowBefore = await db.query(`SELECT status, objective_score, manual_score, total_score, reward_stars_awarded FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId]);
  
  // Trigger various integrity events
  await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
  await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur');`, [student3Id, attemptLogId]);
  await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student3Id, attemptLogId]);

  const draftRowAfter = await db.query(`SELECT status, objective_score, manual_score, total_score, reward_stars_awarded FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId]);

  // Test 24: no score mutation
  assert(draftRowBefore.rows[0].objective_score === draftRowAfter.rows[0].objective_score, 'Test 24: objective_score unchanged');
  assert(draftRowBefore.rows[0].manual_score === draftRowAfter.rows[0].manual_score, 'Test 24: manual_score unchanged');
  assert(draftRowBefore.rows[0].total_score === draftRowAfter.rows[0].total_score, 'Test 24: total_score unchanged');

  // Test 25: no reward mutation
  assert(draftRowBefore.rows[0].reward_stars_awarded === draftRowAfter.rows[0].reward_stars_awarded, 'Test 25: reward_stars_awarded unchanged');

  // Test 26: no status mutation
  assert(draftRowAfter.rows[0].status === 'draft', 'Test 26: status remains draft (no auto-submit / auto-fail)');

  // Test 27: no answer mutation
  const answersCount = await db.query(`SELECT count(*)::int as cnt FROM public.exam_attempt_answers WHERE attempt_id = $1::uuid;`, [attemptLogId]);
  assert(answersCount.rows[0].cnt === 0, 'Test 27: answers table untouched');

  console.log('\n--- SECTION 6: DB CONSTRAINTS & PARAMS (TESTS 28 - 30) ---');
  // Test 28: required params check
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event(NULL, $1::uuid, 'page_hidden');`, [attemptLogId]),
    'ERR_REQUIRED_PARAMS',
    'Test 28a: NULL caller_id rejected'
  );
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, NULL, 'page_hidden');`, [student3Id]),
    'ERR_REQUIRED_PARAMS',
    'Test 28b: NULL attempt_id rejected'
  );
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, NULL);`, [student3Id, attemptLogId]),
    'ERR_REQUIRED_PARAMS',
    'Test 28c: NULL source rejected'
  );

  // Test 29: invalid source rejected
  await assertRejects(
    () => db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'mouse_leave');`, [student3Id, attemptLogId]),
    'ERR_INVALID_EVENT_SOURCE',
    'Test 29: invalid source mouse_leave rejected'
  );

  // Test 30: nullable client_timestamp works
  {
    const resNullTs = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden', NULL);`, [student3Id, attemptLogId]);
    assert(resNullTs.rows[0].rpc_exam_record_integrity_event.event_recorded === true, 'Test 30a: NULL client_timestamp accepted');

    const specificTs = '2026-09-06T12:34:56.789Z';
    const resWithTs = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible', $3::timestamptz);`, [student3Id, attemptLogId, specificTs]);
    assert(resWithTs.rows[0].rpc_exam_record_integrity_event.event_recorded === true, 'Test 30b: explicit client_timestamp accepted');
    
    const lastAudit = await db.query(`SELECT client_timestamp FROM public.exam_audit_events WHERE attempt_id = $1::uuid ORDER BY created_at DESC LIMIT 1;`, [attemptLogId]);
    assert(new Date(lastAudit.rows[0].client_timestamp).toISOString() === specificTs, 'Test 30b: client_timestamp matches exact stored value');
  }

  console.log('\n--- SECTION 7: ATOMICITY & IDEMPOTENCY (TESTS 31 - 33) ---');
  // Test 31: duplicate open idempotency
  {
    const open1 = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
    const openData1 = open1.rows[0].rpc_exam_record_integrity_event;
    const countAfterOpen1 = openData1.tab_switch_count;
    const activeEp = openData1.active_leave_episode_id;

    // Call open again
    const open2 = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
    const openData2 = open2.rows[0].rpc_exam_record_integrity_event;

    assert(openData2.event_recorded === false, 'Test 31: duplicate open returns event_recorded=false');
    assert(openData2.idempotent_replay === true, 'Test 31: duplicate open returns idempotent_replay=true');
    assert(openData2.tab_switch_count === countAfterOpen1, 'Test 31: tab_switch_count unchanged on replay');
    assert(openData2.active_leave_episode_id === activeEp, 'Test 31: active_leave_episode_id preserved on replay');
  }

  // Test 32: duplicate close idempotency
  {
    const close1 = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student3Id, attemptLogId]);
    const closeData1 = close1.rows[0].rpc_exam_record_integrity_event;
    assert(closeData1.event_recorded === true, 'Test 32: first close records event');
    assert(closeData1.active_leave_episode_id === null, 'Test 32: first close clears active episode');

    // Call close again (with window_focus this time)
    const close2 = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_focus');`, [student3Id, attemptLogId]);
    const closeData2 = close2.rows[0].rpc_exam_record_integrity_event;
    assert(closeData2.event_recorded === false, 'Test 32: second close returns event_recorded=false');
    assert(closeData2.idempotent_replay === true, 'Test 32: second close returns idempotent_replay=true');
    assert(closeData2.active_leave_episode_id === null, 'Test 32: active episode remains null');
  }

  // Test 33: audit insert + attempt update atomicity (checked via active_leave_episode_id and count sync)
  {
    const openRes = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
    const epId = openRes.rows[0].rpc_exam_record_integrity_event.active_leave_episode_id;

    const [attRow, auditRow] = await Promise.all([
      db.query(`SELECT active_leave_episode_id, tab_switch_count FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId]),
      db.query(`SELECT episode_id, event_type FROM public.exam_audit_events WHERE attempt_id = $1::uuid AND episode_id = $2::uuid;`, [attemptLogId, epId])
    ]);

    assert(attRow.rows[0].active_leave_episode_id === epId, 'Test 33: attempt row has episode id');
    assert(auditRow.rows.length === 1, 'Test 33: audit event exists with matching episode id');
    assert(auditRow.rows[0].event_type === 'episode_opened', 'Test 33: audit event type is episode_opened');
  }

  console.log('\n--- SECTION 7B: CLOSE ON CONFLICT TRUTHFULNESS HARDENING ---');
  // Test 33b: Simulate preexisting episode_closed row to test ON CONFLICT DO NOTHING -> ROW_COUNT = 0
  {
    // 1. Open new episode
    const openRes = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student3Id, attemptLogId]);
    const epId = openRes.rows[0].rpc_exam_record_integrity_event.active_leave_episode_id;
    assert(epId !== null, 'Test 33b setup: episode opened');

    // 2. Pre-insert episode_closed row manually
    await db.query(`
      INSERT INTO public.exam_audit_events (attempt_id, episode_id, event_type, signal_source, client_timestamp, metadata)
      VALUES ($1::uuid, $2::uuid, 'episode_closed', 'page_visible', NOW(), '{}'::jsonb);
    `, [attemptLogId, epId]);

    // 3. Call RPC close: INSERT will hit ON CONFLICT DO NOTHING, ROW_COUNT = 0
    const closeRes = await db.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible');`, [student3Id, attemptLogId]);
    const closeData = closeRes.rows[0].rpc_exam_record_integrity_event;

    // Must truthfully return event_recorded = false and idempotent_replay = true
    assert(closeData.event_recorded === false, 'Test 33b: close event_recorded is false when ON CONFLICT triggers');
    assert(closeData.idempotent_replay === true, 'Test 33b: close idempotent_replay is true when ON CONFLICT triggers');
    assert(closeData.event_type === 'episode_closed', 'Test 33b: event_type is episode_closed');
    assert(closeData.active_leave_episode_id === null, 'Test 33b: active_leave_episode_id is cleared to NULL');
  }

  console.log('\n--- SECTION 8: SECURITY & ACL CHECKS (TESTS 34 - 40) ---');
  // Test 34 - 36: Revoked permissions
  const aclQuery = await db.query(`
    SELECT grantee, privilege_type 
    FROM information_schema.routine_privileges 
    WHERE routine_name = 'rpc_exam_record_integrity_event'
      AND routine_schema = 'public';
  `);

  const grantees = aclQuery.rows.map(r => r.grantee);
  console.log('Function Grantees:', grantees);

  // Test 34: PUBLIC revoked
  assert(!grantees.includes('PUBLIC'), 'Test 34: ACL PUBLIC revoked');

  // Test 35: anon revoked
  assert(!grantees.includes('anon'), 'Test 35: ACL anon revoked');

  // Test 36: authenticated revoked
  assert(!grantees.includes('authenticated'), 'Test 36: ACL authenticated revoked');

  // Test 37: service_role granted
  assert(grantees.includes('service_role'), 'Test 37: service_role execute granted');

  // Test 38 & 39: postgres owner & execution
  const procInfo = await db.query(`
    SELECT 
      p.proname,
      pg_get_userbyid(p.proowner) as owner,
      p.prosecdef as security_definer,
      p.proconfig as config
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'rpc_exam_record_integrity_event';
  `);

  assert(procInfo.rows.length === 1, 'Test 38: Function found in pg_proc');
  assert(procInfo.rows[0].owner === 'postgres', 'Test 39: Owner is postgres');
  assert(procInfo.rows[0].security_definer === true, 'Test 38: Function is SECURITY DEFINER');

  // Test 40: fixed search_path
  const config = procInfo.rows[0].config;
  const hasSearchPath = config && config.some(c => c.includes('search_path=public, app_private') || c.includes('search_path=public,app_private'));
  assert(hasSearchPath, `Test 40: Fixed search_path is set (got: ${JSON.stringify(config)})`);

  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
