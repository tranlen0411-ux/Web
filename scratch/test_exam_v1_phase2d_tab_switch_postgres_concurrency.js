import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// STRICT LOCAL ENVIRONMENT GUARD
const FORBIDDEN_REMOTE_PATTERNS = [
  'supabase.co',
  'szptvqkoiphrhlionfoh',
  'nddimmxpymipalpxlops',
  'pooler.supabase',
  'amazonaws.com',
  'azure',
  'render.com',
  'railway.app'
];

const ALLOWED_LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', 'host.docker.internal'];

function validateLocalTarget(connStr) {
  try {
    const url = new URL(connStr);
    const host = url.hostname.toLowerCase();

    for (const pattern of FORBIDDEN_REMOTE_PATTERNS) {
      if (connStr.toLowerCase().includes(pattern)) {
        throw new Error(`SECURITY ALERT: Forbidden remote/cloud host detected: ${pattern}`);
      }
    }

    if (!ALLOWED_LOCAL_HOSTS.includes(host)) {
      throw new Error(`SECURITY ALERT: Target host "${host}" is not in allowed local hosts [${ALLOWED_LOCAL_HOSTS.join(', ')}]`);
    }

    return { host, port: url.port || '5432', database: url.pathname.slice(1) || 'postgres' };
  } catch (err) {
    throw new Error(`Invalid local connection string: ${err.message}`);
  }
}

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

async function runRealPostgresSuite(connString) {
  const guard = validateLocalTarget(connString);
  console.log(`🔒 LOCAL GUARD VERIFIED: Host=${guard.host}, Port=${guard.port}, DB=${guard.database}`);

  const pool = new Pool({ connectionString: connString, max: 10 });
  let actualVersion = '';

  // Test connection & get real version
  try {
    const probe = await pool.query('SELECT version();');
    actualVersion = probe.rows[0].version;
    console.log(`🐘 Connected to Real PostgreSQL: ${actualVersion.split('\n')[0]}\n`);
  } catch (err) {
    console.warn(`⚠️ Cannot connect to local PostgreSQL at ${connString}: ${err.message}`);
    return { skipped: true, reason: err.message };
  }

  // Setup Postgres environment & Supabase roles on test database
  await pool.query(`
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

  // Apply migrations 1..7
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
    await pool.query(sql);
    console.log(`📦 Applied migration ${i + 1}/${migrationFiles.length}: ${f}`);
  }

  console.log('\n--- SETTING UP REAL POSTGRES FIXTURES ---');
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const student1Id = '22222222-2222-4222-8222-222222222201';
  const student2Id = '22222222-2222-4222-8222-222222222202';
  const student3Id = '22222222-2222-4222-8222-222222222203';
  const student4Id = '22222222-2222-4222-8222-222222222204';
  const classId = '33333333-3333-4333-8333-333333333301';

  // Exam Log (WARN_AND_LOG)
  const examLogId = '44444444-4444-4444-8444-444444444403';
  const verLogId = '55555555-5555-4555-8555-555555555503';
  const assignLogId = '66666666-6666-4666-8666-666666666603';
  const qLogId = '88888888-8888-4888-8888-888888888803';

  await pool.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam LOG', 'MATH', 10);`, [teacherId, examLogId, verLogId]);
  await pool.query(`
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
  await pool.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verLogId]);
  await pool.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignLogId, verLogId, classId]);

  // Exam OFF
  const examOffId = '44444444-4444-4444-8444-444444444401';
  const verOffId = '55555555-5555-4555-8555-555555555501';
  const assignOffId = '66666666-6666-4666-8666-666666666601';
  const qOffId = '88888888-8888-4888-8888-888888888801';

  await pool.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam OFF', 'MATH', 10);`, [teacherId, examOffId, verOffId]);
  await pool.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1::uuid, $2::uuid, 'Exam OFF', 'MATH', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'OFF', true, false,
      $3::jsonb, true
    );
  `, [teacherId, verOffId, JSON.stringify([{ id: qOffId, question_number: 1, question_type: 'single_choice', prompt: '1+1=?', points: 10.0, options_json: [{ key: 'A', text: '2' }], answer_key: { correct_answer: 'A' } }])]);
  await pool.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verOffId]);
  await pool.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignOffId, verOffId, classId]);

  // Exam WARN_ONLY
  const examWarnId = '44444444-4444-4444-8444-444444444402';
  const verWarnId = '55555555-5555-4555-8555-555555555502';
  const assignWarnId = '66666666-6666-4666-8666-666666666602';
  const qWarnId = '88888888-8888-4888-8888-888888888802';

  await pool.query(`SELECT public.rpc_exam_create_test($1::uuid, $2::uuid, $3::uuid, 'Exam WARN', 'MATH', 10);`, [teacherId, examWarnId, verWarnId]);
  await pool.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1::uuid, $2::uuid, 'Exam WARN', 'MATH', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'WARN_ONLY', true, false,
      $3::jsonb, true
    );
  `, [teacherId, verWarnId, JSON.stringify([{ id: qWarnId, question_number: 1, question_type: 'single_choice', prompt: '2+2=?', points: 10.0, options_json: [{ key: 'A', text: '4' }], answer_key: { correct_answer: 'A' } }])]);
  await pool.query(`SELECT public.rpc_exam_publish_version($1::uuid, $2::uuid, true);`, [teacherId, verWarnId]);
  await pool.query(`SELECT public.rpc_exam_create_assignment($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW() + interval '7 days', true, true);`, [teacherId, assignWarnId, verWarnId, classId]);

  console.log('✅ Real Postgres Fixtures Created.');

  console.log('\n--- 1. CONCURRENT OPEN TEST (REAL POSTGRES PARALLEL POOL) ---');
  const attemptLogId = '77777777-7777-4777-8777-777777777703';
  await pool.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student3Id, attemptLogId, assignLogId, student3Id]);

  const client1 = await pool.connect();
  const client2 = await pool.connect();

  try {
    const [resOpen1, resOpen2] = await Promise.all([
      client1.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden', NOW());`, [student3Id, attemptLogId]),
      client2.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden', NOW());`, [student3Id, attemptLogId])
    ]);

    const d1 = resOpen1.rows[0].rpc_exam_record_integrity_event;
    const d2 = resOpen2.rows[0].rpc_exam_record_integrity_event;

    const recordedTrueCount = (d1.event_recorded ? 1 : 0) + (d2.event_recorded ? 1 : 0);
    const replayTrueCount = (d1.idempotent_replay ? 1 : 0) + (d2.idempotent_replay ? 1 : 0);

    assert(recordedTrueCount === 1, 'Concurrent OPEN: exactly one response has event_recorded = true');
    assert(replayTrueCount === 1, 'Concurrent OPEN: exactly one response has idempotent_replay = true');
    assert(d1.tab_switch_count === 1 && d2.tab_switch_count === 1, 'Concurrent OPEN: both return tab_switch_count = 1');
    assert(d1.active_leave_episode_id !== null && d1.active_leave_episode_id === d2.active_leave_episode_id, 'Concurrent OPEN: both return the same active_leave_episode_id');

    const [auditRows, attRow] = await Promise.all([
      pool.query(`SELECT * FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attemptLogId]),
      pool.query(`SELECT tab_switch_count, active_leave_episode_id FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId])
    ]);

    assert(auditRows.rows.length === 1, 'Concurrent OPEN DB: exactly 1 episode_opened row inserted');
    assert(auditRows.rows[0].event_type === 'episode_opened', 'Concurrent OPEN DB: event_type is episode_opened');
    assert(attRow.rows[0].tab_switch_count === 1, 'Concurrent OPEN DB: tab_switch_count is exactly 1');
    assert(attRow.rows[0].active_leave_episode_id !== null, 'Concurrent OPEN DB: active_leave_episode_id is set');

    console.log(`REAL_CONCURRENT_OPEN=PASS`);
    console.log(`OPEN_EVENT_ROWS=1`);
    console.log(`OPEN_COUNT_INCREMENT=1`);
    console.log(`OPEN_RESPONSE_TRUE_COUNT=1`);
    console.log(`OPEN_RESPONSE_REPLAY_COUNT=1`);
  } finally {
    client1.release();
    client2.release();
  }

  console.log('\n--- 2. CONCURRENT CLOSE TEST (REAL POSTGRES PARALLEL POOL) ---');
  const client3 = await pool.connect();
  const client4 = await pool.connect();

  try {
    const [resClose1, resClose2] = await Promise.all([
      client3.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_visible', NOW());`, [student3Id, attemptLogId]),
      client4.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_focus', NOW());`, [student3Id, attemptLogId])
    ]);

    const c1 = resClose1.rows[0].rpc_exam_record_integrity_event;
    const c2 = resClose2.rows[0].rpc_exam_record_integrity_event;

    const closeRecordedTrueCount = (c1.event_recorded ? 1 : 0) + (c2.event_recorded ? 1 : 0);
    const closeReplayTrueCount = (c1.idempotent_replay ? 1 : 0) + (c2.idempotent_replay ? 1 : 0);

    assert(closeRecordedTrueCount === 1, 'Concurrent CLOSE: exactly one response has event_recorded = true');
    assert(closeReplayTrueCount === 1, 'Concurrent CLOSE: exactly one response has idempotent_replay = true');
    assert(c1.active_leave_episode_id === null && c2.active_leave_episode_id === null, 'Concurrent CLOSE: both return active_leave_episode_id = null');
    assert(c1.tab_switch_count === 1 && c2.tab_switch_count === 1, 'Concurrent CLOSE: tab_switch_count unchanged at 1');

    const [auditClosedRows, attAfterClose] = await Promise.all([
      pool.query(`SELECT * FROM public.exam_audit_events WHERE attempt_id = $1::uuid AND event_type = 'episode_closed';`, [attemptLogId]),
      pool.query(`SELECT tab_switch_count, active_leave_episode_id FROM public.exam_attempts WHERE id = $1::uuid;`, [attemptLogId])
    ]);

    assert(auditClosedRows.rows.length === 1, 'Concurrent CLOSE DB: exactly 1 episode_closed row for active episode');
    assert(attAfterClose.rows[0].active_leave_episode_id === null, 'Concurrent CLOSE DB: active_leave_episode_id is NULL');

    console.log(`REAL_CONCURRENT_CLOSE=PASS`);
    console.log(`CLOSE_EVENT_ROWS=1`);
    console.log(`ACTIVE_EPISODE_AFTER_CLOSE=NULL`);
    console.log(`CLOSE_RESPONSE_TRUE_COUNT=1`);
    console.log(`CLOSE_RESPONSE_REPLAY_COUNT=1`);
  } finally {
    client3.release();
    client4.release();
  }

  console.log('\n--- 3. AUXILIARY CONCURRENCY TEST (REAL POSTGRES) ---');
  const client5 = await pool.connect();
  const client6 = await pool.connect();

  try {
    const [resBlur1, resBlur2] = await Promise.all([
      client5.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur', NOW());`, [student3Id, attemptLogId]),
      client6.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'window_blur', NOW());`, [student3Id, attemptLogId])
    ]);

    const b1 = resBlur1.rows[0].rpc_exam_record_integrity_event;
    const b2 = resBlur2.rows[0].rpc_exam_record_integrity_event;

    assert(b1.event_recorded === true && b2.event_recorded === true, 'Concurrent Blur: each window_blur recorded');
    assert(b1.tab_switch_count === 1 && b2.tab_switch_count === 1, 'Concurrent Blur: count unchanged at 1');
    assert(b1.active_leave_episode_id === null && b2.active_leave_episode_id === null, 'Concurrent Blur: active episode unchanged (null)');

    const blurRows = await pool.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid AND event_type = 'focus_loss_auxiliary';`, [attemptLogId]);
    assert(blurRows.rows[0].cnt === 2, 'Concurrent Blur DB: exactly 2 auxiliary events stored');

    console.log(`WINDOW_BLUR_CONCURRENCY=PASS`);
    console.log(`WINDOW_BLUR_COUNT_MUTATION=NO`);
    console.log(`WINDOW_BLUR_ACTIVE_EPISODE_MUTATION=NO`);
  } finally {
    client5.release();
    client6.release();
  }

  console.log('\n--- 4. POLICY CHECK ON REAL POSTGRES ---');
  const attOffId = '77777777-7777-4777-8777-777777777701';
  await pool.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student1Id, attOffId, assignOffId, student1Id]);
  const offRes = await pool.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student1Id, attOffId]);
  assert(offRes.rows[0].rpc_exam_record_integrity_event.event_recorded === false, 'OFF policy: event_recorded = false');
  const offAudit = await pool.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attOffId]);
  assert(offAudit.rows[0].cnt === 0, 'OFF policy DB: 0 audit rows');

  const attWarnId = '77777777-7777-4777-8777-777777777702';
  await pool.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student2Id, attWarnId, assignWarnId, student2Id]);
  const warnRes = await pool.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student2Id, attWarnId]);
  assert(warnRes.rows[0].rpc_exam_record_integrity_event.event_recorded === false, 'WARN_ONLY policy: event_recorded = false');
  const warnAudit = await pool.query(`SELECT count(*)::int as cnt FROM public.exam_audit_events WHERE attempt_id = $1::uuid;`, [attWarnId]);
  assert(warnAudit.rows[0].cnt === 0, 'WARN_ONLY policy DB: 0 audit rows');

  console.log(`OFF_REAL_DB=PASS`);
  console.log(`WARN_ONLY_REAL_DB=PASS`);

  console.log('\n--- 5. FINALIZED ATTEMPT CHECKS ON REAL POSTGRES ---');
  const attId4 = '77777777-7777-4777-8777-777777777704';
  await pool.query(`SELECT public.rpc_exam_start_attempt($1::uuid, $2::uuid, $3::uuid, $4::uuid);`, [student4Id, attId4, assignLogId, student4Id]);
  await pool.query(`SELECT public.rpc_exam_save_answer($1::uuid, $2::uuid, $3::uuid, '"A"'::jsonb, NULL, 1);`, [student4Id, attId4, qLogId]);
  await pool.query(`SELECT public.rpc_exam_submit_attempt($1::uuid, $2::uuid, 2);`, [student4Id, attId4]);

  await assertRejects(
    () => pool.query(`SELECT public.rpc_exam_record_integrity_event($1::uuid, $2::uuid, 'page_hidden');`, [student4Id, attId4]),
    'ERR_ATTEMPT_NOT_DRAFT',
    'Real Postgres: submitted attempt rejected'
  );
  console.log(`FINALIZED_STATUS_REAL_DB=PASS`);

  console.log('\n--- 6. SECURITY & ACL FINGERPRINT (REAL POSTGRES) ---');
  const procInfo = await pool.query(`
    SELECT 
      p.proname,
      pg_get_userbyid(p.proowner) as owner,
      p.prosecdef as security_definer,
      p.proconfig as config
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'rpc_exam_record_integrity_event';
  `);

  assert(procInfo.rows[0].security_definer === true, 'Security: prosecdef = true');
  assert(procInfo.rows[0].owner === 'postgres', 'Security: owner = postgres');
  const hasSearchPath = procInfo.rows[0].config && procInfo.rows[0].config.some(c => c.includes('search_path=public, app_private') || c.includes('search_path=public,app_private'));
  assert(hasSearchPath, 'Security: fixed search_path = public, app_private');

  const aclQuery = await pool.query(`
    SELECT grantee 
    FROM information_schema.routine_privileges 
    WHERE routine_name = 'rpc_exam_record_integrity_event'
      AND routine_schema = 'public';
  `);
  const grantees = aclQuery.rows.map(r => r.grantee);
  assert(!grantees.includes('PUBLIC'), 'ACL: PUBLIC revoked');
  assert(!grantees.includes('anon'), 'ACL: anon revoked');
  assert(!grantees.includes('authenticated'), 'ACL: authenticated revoked');
  assert(grantees.includes('service_role'), 'ACL: service_role granted');

  await pool.end();
  return { skipped: false, version: actualVersion };
}

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - REAL POSTGRES CONCURRENCY TEST GATE');
  console.log('====================================================\n');

  // If explicit remote connection is provided via env, guard immediately rejects
  const explicitUrl = process.env.LOCAL_POSTGRES_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (explicitUrl) {
    try {
      validateLocalTarget(explicitUrl);
    } catch (guardErr) {
      console.error(`❌ REMOTE HOST BLOCKED BY GUARD: ${guardErr.message}`);
      console.log('REAL_POSTGRES_AVAILABLE=NO');
      console.log('REAL_SCRIPT_EXECUTED=NO');
      console.log('REAL_CONCURRENCY_TESTS_RUN=0');
      console.log('PHASE2D_CONCURRENCY_GATE_PASS=NO');
      process.exit(1);
    }
  }

  const localCandidates = [
    explicitUrl,
    'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  ].filter(Boolean);

  let executed = false;
  let executedVersion = '';

  for (const connStr of localCandidates) {
    try {
      validateLocalTarget(connStr);
      console.log(`Checking local candidate: ${connStr.replace(/:[^:@]+@/, ':***@')} ...`);
      const res = await runRealPostgresSuite(connStr);
      if (!res.skipped) {
        executed = true;
        executedVersion = res.version;
        break;
      }
    } catch (err) {
      console.log(`Guard/Connection note for candidate: ${err.message}`);
    }
  }

  if (!executed) {
    console.log('\n----------------------------------------------------');
    console.log('REAL_POSTGRES_AVAILABLE=NO');
    console.log('REAL_SCRIPT_EXECUTED=NO');
    console.log('REAL_CONCURRENCY_TESTS_RUN=0');
    console.log('PHASE2D_CONCURRENCY_GATE_PASS=NO');
    console.log('PG_TARGET_CLASSIFICATION=LOCAL_DISPOSABLE');
    console.log('POSTGRES_VERSION=NOT_RUN');
    console.log('OPEN_EVENT_ROWS=NOT_RUN');
    console.log('CLOSE_EVENT_ROWS=NOT_RUN');
    console.log('OFF_REAL=NOT_RUN');
    console.log('WARN_ONLY_REAL=NOT_RUN');
    console.log('FINALIZED_REAL=NOT_RUN');
    console.log('SECURITY_FINGERPRINT_REAL=NOT_RUN');
    console.log('----------------------------------------------------\n');
    console.log(`TOTAL TESTS RUN: ${totalTests}`);
    console.log(`PASSED: ${passedTests}`);
    console.log(`FAILED: ${failedTests}`);
    // Nonzero exit code as required when real postgres is unavailable
    process.exit(2);
  }

  console.log('====================================================');
  console.log(`REAL_POSTGRES_AVAILABLE=YES`);
  console.log(`REAL_SCRIPT_EXECUTED=YES`);
  console.log(`POSTGRES_VERSION=${executedVersion}`);
  console.log(`TOTAL TESTS RUN: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log(`PHASE2D_CONCURRENCY_GATE_PASS=YES`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
