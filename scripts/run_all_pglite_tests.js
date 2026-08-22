import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ --liftoff-only kết hợp các cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên Windows
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--no-concurrent-recompilation',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      '--max-old-space-size=4096',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function truncateAll(db) {
  await db.exec(`
    TRUNCATE TABLE 
      public.academic_submissions,
      public.academic_exercise_questions,
      public.academic_exercise_assignments,
      public.academic_exercises,
      public.ranking_periods,
      public.class_members,
      public.classes,
      public.profiles
    CASCADE;
  `);
}

async function setupDatabaseWithSchema(PGlite) {
  const db = new PGlite();

  // 1. Stubs & Helper functions
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

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    $$;

    CREATE SCHEMA IF NOT EXISTS app_private;

    CREATE OR REPLACE FUNCTION app_private.can_manage_class(p_class_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    DECLARE
      v_uid UUID := (SELECT auth.uid());
      v_role TEXT;
      v_disabled BOOLEAN;
    BEGIN
      IF v_uid IS NULL THEN RETURN FALSE; END IF;
      SELECT role, COALESCE(is_disabled, false) INTO v_role, v_disabled FROM public.profiles WHERE id = v_uid;
      IF v_disabled IS TRUE THEN RETURN FALSE; END IF;
      IF v_role = 'admin' THEN RETURN TRUE; END IF;
      IF v_role = 'teacher' THEN
        RETURN EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_uid);
      END IF;
      RETURN FALSE;
    END;
    $$;
  `);

  // 2. DDL tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      role TEXT,
      full_name TEXT,
      avatar_url TEXT,
      is_disabled BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY,
      name TEXT,
      grade_level INT,
      teacher_id UUID
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID,
      student_id UUID,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercises (
      id UUID PRIMARY KEY,
      title TEXT,
      subject TEXT,
      status TEXT,
      class_id UUID,
      teacher_id UUID,
      due_date TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID,
      class_id UUID,
      assigned_by UUID,
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      due_date TIMESTAMPTZ,
      counts_toward_ranking BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID,
      question_type TEXT,
      points NUMERIC
    );

    CREATE TABLE IF NOT EXISTS public.academic_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID,
      exercise_id UUID,
      status TEXT,
      total_score NUMERIC,
      objective_score NUMERIC,
      max_score NUMERIC
    );

    CREATE TABLE IF NOT EXISTS public.ranking_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES public.classes(id),
      name TEXT NOT NULL,
      period_type TEXT NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_by UUID REFERENCES public.profiles(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_by UUID,
      closed_at TIMESTAMPTZ
    );
  `);

  // 3. Nạp RPC thật get_academic_class_leaderboard từ ADD_ACADEMIC_CLASS_LEADERBOARD.sql
  const sqlPath = path.resolve(__dirname, '../ADD_ACADEMIC_CLASS_LEADERBOARD.sql');
  const sqlContent = await fs.readFile(sqlPath, 'utf8');

  const startSignature = 'DROP FUNCTION IF EXISTS public.get_academic_class_leaderboard(UUID, TEXT, TEXT);';
  const startIdx = sqlContent.indexOf(startSignature);
  const grantSignature = 'GRANT EXECUTE ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) TO authenticated;';
  const grantIdx = sqlContent.indexOf(grantSignature, startIdx);

  const rpcSql = sqlContent.substring(startIdx, grantIdx + grantSignature.length);
  await db.exec(rpcSql);

  // 4. Nạp RPC delete_draft_ranking_period từ DELETE_DRAFT_RANKING_PERIOD.sql
  const deleteSqlPath = path.resolve(__dirname, '../DELETE_DRAFT_RANKING_PERIOD.sql');
  const deleteSqlContent = await fs.readFile(deleteSqlPath, 'utf8');
  await db.exec(deleteSqlContent);

  return db;
}

// 1. Suite: test_pglite_smoke.js
async function runSuite1(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_smoke.js`);
  console.log(`------------------------------------------------------------`);
  const result = await db.query('SELECT 1 AS ok;');
  assert.strictEqual(Number(result.rows[0]?.ok), 1, 'Smoke test: ok phải là 1');
  console.log('✅ PGLITE SMOKE TEST PASS');
}

// 2. Suite: test_pglite_auth_stub.js
async function runSuite2(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_auth_stub.js`);
  console.log(`------------------------------------------------------------`);
  const expectedUuid = '11111111-1111-1111-1111-111111111111';
  await db.exec(`SELECT set_config('app.current_user_id', '${expectedUuid}', false);`);
  const res = await db.query('SELECT auth.uid() AS uid;');
  assert.strictEqual(res.rows[0]?.uid, expectedUuid, 'Auth stub: UID không khớp');
  console.log('✅ PGLITE AUTH STUB PASS');
}

// 3. Suite: test_pglite_rpc_compile.js
async function runSuite3(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_rpc_compile.js`);
  console.log(`------------------------------------------------------------`);
  const verifyRes = await db.query(`
    SELECT p.proname, n.nspname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_academic_class_leaderboard', 'delete_draft_ranking_period');
  `);
  assert.strictEqual(verifyRes.rows.length, 2, 'RPC compile: Cả 2 function phải tồn tại trong pg_proc');
  console.log('✅ PGLITE RPC COMPILE PASS');
}

// 4. Suite: test_pglite_rpc_basic_runtime.js
async function runSuite4(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_rpc_basic_runtime.js`);
  console.log(`------------------------------------------------------------`);
  await truncateAll(db);

  const teacherId = 'a0000000-0000-0000-0000-000000000001';
  const classId = 'c0000000-0000-0000-0000-000000000001';
  const student1Id = 'b0000000-0000-0000-0000-000000000001';
  const student2Id = 'b0000000-0000-0000-0000-000000000002';
  const exerciseId = 'e0000000-0000-0000-0000-000000000001';

  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name) VALUES
    ('${teacherId}', 'teacher', 'Thầy Giáo Phụ Trách'),
    ('${student1Id}', 'student', 'Nguyễn Văn Học Sinh 1'),
    ('${student2Id}', 'student', 'Trần Thị Học Sinh 2');

    INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
    ('${classId}', 'Lớp 5A', 5, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
    ('${classId}', '${student1Id}'),
    ('${classId}', '${student2Id}');

    INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
    ('${exerciseId}', 'Bài tập Toán ôn tập 1', 'Toán', 'published', '${classId}', '${teacherId}');

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
    ('${exerciseId}', '${classId}', '${teacherId}', NOW(), TRUE);

    INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
    ('${exerciseId}', 'multiple_choice', 5.0),
    ('${exerciseId}', 'single_choice', 5.0);

    INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
    ('${student1Id}', '${exerciseId}', 'graded', 10.0, 10.0),
    ('${student2Id}', '${exerciseId}', 'graded', 6.0, 6.0);
  `);

  await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
  const rpcResult = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
  const json = rpcResult.rows[0]?.result;

  assert.strictEqual(json.success, true, 'Runtime: success phải là true');
  assert.strictEqual(json.class_info.class_id, classId, 'Runtime: class_id đúng');
  assert.strictEqual(json.leaderboard.length, 2, 'Runtime: 2 học sinh');
  assert.strictEqual(Number(json.total_valid_exercises), 1, 'Runtime: total_valid_exercises = 1');
  assert.strictEqual(json.leaderboard[0].student_id, student1Id, 'Runtime: Học sinh 10đ phải đứng đầu');
  assert.strictEqual(Number(json.leaderboard[0].rank), 1, 'Runtime: Rank top 1 phải = 1');

  console.log('✅ PGLITE RPC BASIC RUNTIME PASS');
}

// 5. Suite: test_pglite_rpc_time_boundaries.js
async function runSuite5(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_rpc_time_boundaries.js`);
  console.log(`------------------------------------------------------------`);
  await truncateAll(db);

  const teacherId = 'a0000000-0000-0000-0000-000000000001';
  const classId = 'c0000000-0000-0000-0000-000000000001';
  const studentId = 'b0000000-0000-0000-0000-000000000001';

  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name) VALUES
    ('${teacherId}', 'teacher', 'Thầy Giáo Phụ Trách'),
    ('${studentId}', 'student', 'Nguyễn Văn Học Sinh');

    INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
    ('${classId}', 'Lớp 5A', 5, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
    ('${classId}', '${studentId}');
  `);

  const testCases = [
    { id: 'e0000000-0000-0000-0000-000000000001', title: 'Ex1', ts: '2026-08-31 23:59:59+07' },
    { id: 'e0000000-0000-0000-0000-000000000002', title: 'Ex2', ts: '2026-09-01 00:00:00+07' },
    { id: 'e0000000-0000-0000-0000-000000000003', title: 'Ex3', ts: '2027-01-09 23:59:59+07' },
    { id: 'e0000000-0000-0000-0000-000000000004', title: 'Ex4', ts: '2027-01-10 00:00:00+07' },
    { id: 'e0000000-0000-0000-0000-000000000005', title: 'Ex5', ts: '2027-05-30 23:59:59+07' },
    { id: 'e0000000-0000-0000-0000-000000000006', title: 'Ex6', ts: '2027-05-31 00:00:00+07' }
  ];

  for (const tc of testCases) {
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
      ('${tc.id}', '${tc.title}', 'Toán', 'published', '${classId}', '${teacherId}');

      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
      ('${tc.id}', '${classId}', '${teacherId}', TIMESTAMPTZ '${tc.ts}', TRUE);

      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
      ('${tc.id}', 'multiple_choice', 10.0);

      INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
      ('${studentId}', '${tc.id}', 'graded', 10.0, 10.0);
    `);
  }

  await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

  async function callRpc(timeRange) {
    const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', '${timeRange}', 'ALL') AS result;`);
    return res.rows[0]?.result;
  }

  const r_hk1 = await callRpc('HK1');
  assert.strictEqual(Number(r_hk1?.total_valid_exercises), 2, 'HK1: 2 bài');

  const r_sem = await callRpc('SEMESTER');
  assert.strictEqual(Number(r_sem?.total_valid_exercises), 2, 'SEMESTER: 2 bài');

  const r_hk2 = await callRpc('HK2');
  assert.strictEqual(Number(r_hk2?.total_valid_exercises), 2, 'HK2: 2 bài');

  const r_fy = await callRpc('FULL_YEAR');
  assert.strictEqual(Number(r_fy?.total_valid_exercises), 4, 'FULL_YEAR: 4 bài');

  const r_all = await callRpc('ALL');
  assert.strictEqual(Number(r_all?.total_valid_exercises), 6, 'ALL: 6 bài');

  console.log('✅ PGLITE RPC TIME BOUNDARIES PASS');
}

// 6. Suite: test_pglite_rpc_scoring_rules.js
async function runSuite6(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_rpc_scoring_rules.js`);
  console.log(`------------------------------------------------------------`);

  const teacherId = 'a0000000-0000-0000-0000-000000000001';
  const classId = 'c0000000-0000-0000-0000-000000000001';
  const studentId = 'b0000000-0000-0000-0000-000000000001';

  // 6.1 Essay
  console.log('⏳ [1/4] Kiểm thử quy tắc câu hỏi tự luận (Essay)...');
  {
    await truncateAll(db);
    const exEssayId = 'e0000000-0000-0000-0000-000000000001';
    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES ('${teacherId}', 'teacher', 'Thầy A'), ('${studentId}', 'student', 'Học Sinh A');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A', 5, '${teacherId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${classId}', '${studentId}');
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES ('${exEssayId}', 'Tự luận', 'Toán', 'published', '${classId}', '${teacherId}');
      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES ('${exEssayId}', '${classId}', '${teacherId}', NOW(), TRUE);
      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES ('${exEssayId}', 'multiple_choice', 5.0), ('${exEssayId}', 'essay', 5.0);
      INSERT INTO public.academic_submissions (student_id, exercise_id, status, objective_score, total_score) VALUES ('${studentId}', '${exEssayId}', 'submitted', 5.0, NULL);
    `);
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
    let res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    let s = res.rows[0]?.result.leaderboard.find(x => x.student_id === studentId);
    assert.strictEqual(Number(s.completed_count), 0, 'Essay submitted: count = 0');

    await db.exec(`UPDATE public.academic_submissions SET status = 'graded', total_score = 8.5 WHERE student_id = '${studentId}';`);
    res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    s = res.rows[0]?.result.leaderboard.find(x => x.student_id === studentId);
    assert.strictEqual(Number(s.total_earned_score), 8.5, 'Essay graded: score = 8.5');
  }

  // 6.2 counts_toward_ranking
  console.log('⏳ [2/4] Kiểm thử cờ counts_toward_ranking (True / False)...');
  {
    await truncateAll(db);
    const exRanked = 'e0000000-0000-0000-0000-000000000001';
    const exUnranked = 'e0000000-0000-0000-0000-000000000002';
    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES ('${teacherId}', 'teacher', 'Thầy A'), ('${studentId}', 'student', 'Học Sinh A');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A', 5, '${teacherId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${classId}', '${studentId}');
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
      ('${exRanked}', 'Bài 1', 'Toán', 'published', '${classId}', '${teacherId}'),
      ('${exUnranked}', 'Bài 2', 'Toán', 'published', '${classId}', '${teacherId}');
      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
      ('${exRanked}', '${classId}', '${teacherId}', NOW(), TRUE),
      ('${exUnranked}', '${classId}', '${teacherId}', NOW(), FALSE);
      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES ('${exRanked}', 'multiple_choice', 10.0), ('${exUnranked}', 'multiple_choice', 10.0);
      INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
      ('${studentId}', '${exRanked}', 'graded', 10.0, 10.0),
      ('${studentId}', '${exUnranked}', 'graded', 10.0, 10.0);
    `);
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
    const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    const data = res.rows[0]?.result;
    assert.strictEqual(Number(data.total_valid_exercises), 1, 'Ranking Flag: total_valid_exercises = 1');
    assert.strictEqual(Number(data.total_class_max_score), 10.0, 'Ranking Flag: total_class_max_score = 10.0');
  }

  // 6.3 Multiple attempts
  console.log('⏳ [3/4] Kiểm thử làm nhiều lần (Multiple attempts - Max score)...');
  {
    await truncateAll(db);
    const exId = 'e0000000-0000-0000-0000-000000000001';
    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES ('${teacherId}', 'teacher', 'Thầy A'), ('${studentId}', 'student', 'Học Sinh A');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A', 5, '${teacherId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${classId}', '${studentId}');
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES ('${exId}', 'Bài 1', 'Toán', 'published', '${classId}', '${teacherId}');
      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES ('${exId}', '${classId}', '${teacherId}', NOW(), TRUE);
      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES ('${exId}', 'multiple_choice', 10.0);
      INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
      ('${studentId}', '${exId}', 'graded', 5.0, 5.0),
      ('${studentId}', '${exId}', 'graded', 9.0, 9.0),
      ('${studentId}', '${exId}', 'graded', 7.0, 7.0);
    `);
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
    const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    const s = res.rows[0]?.result.leaderboard.find(x => x.student_id === studentId);
    assert.strictEqual(Number(s.completed_count), 1, 'Multiple attempts: count = 1');
    assert.strictEqual(Number(s.total_earned_score), 9.0, 'Multiple attempts: max score = 9.0');
  }

  // 6.4 Subject Filter
  console.log('⏳ [4/4] Kiểm thử bộ lọc môn học (Subject Filter)...');
  {
    await truncateAll(db);
    const exMath = 'e0000000-0000-0000-0000-000000000001';
    const exViet = 'e0000000-0000-0000-0000-000000000002';
    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES ('${teacherId}', 'teacher', 'Thầy A'), ('${studentId}', 'student', 'Học Sinh A');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A', 5, '${teacherId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${classId}', '${studentId}');
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
      ('${exMath}', 'Toán', 'Toán', 'published', '${classId}', '${teacherId}'),
      ('${exViet}', 'Tiếng Việt', 'Tiếng Việt', 'published', '${classId}', '${teacherId}');
      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
      ('${exMath}', '${classId}', '${teacherId}', NOW(), TRUE),
      ('${exViet}', '${classId}', '${teacherId}', NOW(), TRUE);
      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES ('${exMath}', 'multiple_choice', 10.0), ('${exViet}', 'multiple_choice', 10.0);
      INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
      ('${studentId}', '${exMath}', 'graded', 8.0, 8.0),
      ('${studentId}', '${exViet}', 'graded', 9.0, 9.0);
    `);
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

    const rMath = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'Toán') AS result;`);
    assert.strictEqual(Number(rMath.rows[0]?.result.total_valid_exercises), 1, 'Subject Toán = 1');

    const rViet = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'Tiếng Việt') AS result;`);
    assert.strictEqual(Number(rViet.rows[0]?.result.total_valid_exercises), 1, 'Subject Tiếng Việt = 1');

    const rAll = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    assert.strictEqual(Number(rAll.rows[0]?.result.total_valid_exercises), 2, 'Subject ALL = 2');
  }

  console.log('✅ PGLITE RPC SCORING RULES PASS');
}

// 7. Suite: test_pglite_rpc_security_and_edge_cases.js
async function runSuite7(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_rpc_security_and_edge_cases.js`);
  console.log(`------------------------------------------------------------`);

  // 7.1 Negative permissions
  console.log('⏳ [1/3] Kiểm thử phân quyền (Negative Permissions & Valid Teacher)...');
  {
    await truncateAll(db);
    const teacherOwnerId = 'a0000000-0000-0000-0000-000000000001';
    const teacherOtherId = 'a0000000-0000-0000-0000-000000000002';
    const studentInClassId = 'b0000000-0000-0000-0000-000000000001';
    const studentOutClassId = 'b0000000-0000-0000-0000-000000000002';
    const classId = 'c0000000-0000-0000-0000-000000000001';

    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${teacherOwnerId}', 'teacher', 'Thầy Phụ Trách Lớp'),
      ('${teacherOtherId}', 'teacher', 'Cô Giáo Lớp Khác'),
      ('${studentInClassId}', 'student', 'Học Sinh Thuộc Lớp'),
      ('${studentOutClassId}', 'student', 'Học Sinh Ngoài Lớp');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A', 5, '${teacherOwnerId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${classId}', '${studentInClassId}');
    `);

    await db.exec(`SELECT set_config('app.current_user_id', '', false);`);
    let res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    assert.strictEqual(res.rows[0]?.result.success, false, 'auth.uid() = NULL phải fail');

    await db.exec(`SELECT set_config('app.current_user_id', '${studentOutClassId}', false);`);
    res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    assert.strictEqual(res.rows[0]?.result.success, false, 'Student out class phải fail');

    await db.exec(`SELECT set_config('app.current_user_id', '${teacherOtherId}', false);`);
    res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    assert.strictEqual(res.rows[0]?.result.success, false, 'Teacher other class phải fail');

    await db.exec(`SELECT set_config('app.current_user_id', '${teacherOwnerId}', false);`);
    res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    assert.strictEqual(res.rows[0]?.result.success, true, 'Teacher owner phải success');
  }

  // 7.2 Tie / ranking
  console.log('⏳ [2/3] Kiểm thử xếp hạng hòa điểm (Tie, DENSE_RANK, is_tied, Secondary criteria)...');
  {
    await truncateAll(db);
    const teacherId = 'a0000000-0000-0000-0000-000000000001';
    const classId = 'c0000000-0000-0000-0000-000000000001';
    const studentAId = 'b0000000-0000-0000-0000-000000000001';
    const studentBId = 'b0000000-0000-0000-0000-000000000002';
    const studentCId = 'b0000000-0000-0000-0000-000000000003';
    const ex1Id = 'e0000000-0000-0000-0000-000000000001';

    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${teacherId}', 'teacher', 'Thầy Phụ Trách'),
      ('${studentAId}', 'student', 'Nguyễn Văn An'),
      ('${studentBId}', 'student', 'Trần Văn Bình'),
      ('${studentCId}', 'student', 'Lê Văn Cường');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A', 5, '${teacherId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${classId}', '${studentAId}'), ('${classId}', '${studentBId}'), ('${classId}', '${studentCId}');
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES ('${ex1Id}', 'Bài 1', 'Toán', 'published', '${classId}', '${teacherId}');
      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES ('${ex1Id}', '${classId}', '${teacherId}', NOW(), TRUE);
      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES ('${ex1Id}', 'multiple_choice', 10.0);
      INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
      ('${studentAId}', '${ex1Id}', 'graded', 10.0, 10.0),
      ('${studentBId}', '${ex1Id}', 'graded', 10.0, 10.0),
      ('${studentCId}', '${ex1Id}', 'graded', 7.0, 7.0);
    `);
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
    const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    const data = res.rows[0]?.result;
    const rankA = data.leaderboard.find(x => x.student_id === studentAId);
    const rankB = data.leaderboard.find(x => x.student_id === studentBId);
    const rankC = data.leaderboard.find(x => x.student_id === studentCId);

    assert.strictEqual(Number(rankA.rank), 1, 'An rank 1');
    assert.strictEqual(Number(rankB.rank), 1, 'Bình rank 1');
    assert.strictEqual(rankA.is_tied, true, 'An is_tied = true');
    assert.strictEqual(rankB.is_tied, true, 'Bình is_tied = true');
    assert.strictEqual(Number(rankC.rank), 2, 'Cường rank 2');
    assert.strictEqual(rankC.is_tied, false, 'Cường is_tied = false');
  }

  // 7.3 Zero valid exercises
  console.log('⏳ [3/3] Kiểm thử lớp không có bài tập hợp lệ (Zero valid exercises)...');
  {
    await truncateAll(db);
    const teacherId = 'a0000000-0000-0000-0000-000000000001';
    const classId = 'c0000000-0000-0000-0000-000000000001';
    const student1Id = 'b0000000-0000-0000-0000-000000000001';
    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name) VALUES ('${teacherId}', 'teacher', 'Thầy A'), ('${student1Id}', 'student', 'Học Sinh 1');
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES ('${classId}', 'Lớp 5A Mới', 5, '${teacherId}');
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${classId}', '${student1Id}');
    `);
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
    const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
    const data = res.rows[0]?.result;
    assert.strictEqual(data.success, true, 'Zero exercises success');
    assert.strictEqual(Number(data.total_valid_exercises), 0, 'Zero exercises total_valid_exercises = 0');
    assert.strictEqual(Number(data.total_class_max_score), 0, 'Zero exercises total_class_max_score = 0');
  }

  console.log('✅ PGLITE RPC SECURITY & EDGE CASES PASS');
}

// 8. Suite: test_pglite_rpc_delete_draft_period.js
async function runSuite8(db) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`▶ RUNNING: test_pglite_rpc_delete_draft_period.js`);
  console.log(`------------------------------------------------------------`);
  await truncateAll(db);

  const teacherOwnerId = 'a0000000-0000-0000-0000-000000000001';
  const teacherOtherId = 'a0000000-0000-0000-0000-000000000002';
  const adminId        = 'a0000000-0000-0000-0000-000000000003';
  const studentId      = 'b0000000-0000-0000-0000-000000000001';
  const classId        = 'c0000000-0000-0000-0000-000000000001';

  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${teacherOwnerId}', 'teacher', 'Cô Giáo Chủ Nhiệm Lớp 1A'),
      ('${teacherOtherId}', 'teacher', 'Thầy Giáo Lớp 1B'),
      ('${adminId}', 'admin', 'Quản Trị Viên Hệ Thống'),
      ('${studentId}', 'student', 'Học Sinh Lớp 1A');

    INSERT INTO public.classes (id, name, teacher_id) VALUES
      ('${classId}', 'Lớp 1A', '${teacherOwnerId}');
  `);

  async function callDeleteDraft(periodId, callerId) {
    if (callerId) {
      await db.exec(`SELECT set_config('app.current_user_id', '${callerId}', false);`);
    } else {
      await db.exec(`SELECT set_config('app.current_user_id', '', false);`);
    }
    const res = await db.query(`SELECT public.delete_draft_ranking_period('${periodId}') AS result;`);
    return res.rows[0]?.result;
  }

  // 8.1 NOT_FOUND
  console.log('⏳ [1/7] Kiểm thử NOT_FOUND (ID không tồn tại)...');
  {
    const nonExistentId = 'f0000000-0000-0000-0000-000000000999';
    const result = await callDeleteDraft(nonExistentId, teacherOwnerId);
    assert.strictEqual(result.success, false, 'TC1: success false');
    assert.strictEqual(result.status, 'NOT_FOUND', 'TC1: status NOT_FOUND');
  }

  // 8.2 Chưa đăng nhập
  console.log('⏳ [2/7] Kiểm thử Chưa đăng nhập (auth.uid() = NULL)...');
  {
    const draftPeriodId = 'd0000000-0000-0000-0000-000000000001';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by)
      VALUES ('${draftPeriodId}', '${classId}', 'Kỳ Nháp Test Auth', 'MONTH', NOW(), NOW() + INTERVAL '30 days', 'DRAFT', '${teacherOwnerId}');
    `);
    const result = await callDeleteDraft(draftPeriodId, null);
    assert.strictEqual(result.success, false, 'TC2: success false');
    assert.strictEqual(result.status, 'FORBIDDEN', 'TC2: status FORBIDDEN');
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 1, 'TC2: Record still exists');
  }

  // 8.3 User không có quyền
  console.log('⏳ [3/7] Kiểm thử User không có quyền (Học sinh / Giáo viên lớp khác)...');
  {
    const draftPeriodId = 'd0000000-0000-0000-0000-000000000001';
    const resStudent = await callDeleteDraft(draftPeriodId, studentId);
    assert.strictEqual(resStudent.success, false, 'TC3a: Student forbidden');
    assert.strictEqual(resStudent.status, 'FORBIDDEN', 'TC3a: status FORBIDDEN');

    const resOtherTeacher = await callDeleteDraft(draftPeriodId, teacherOtherId);
    assert.strictEqual(resOtherTeacher.success, false, 'TC3b: Other teacher forbidden');
    assert.strictEqual(resOtherTeacher.status, 'FORBIDDEN', 'TC3b: status FORBIDDEN');

    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 1, 'TC3: Record still exists');
  }

  // 8.4 ACTIVE bị chặn
  console.log('⏳ [4/7] Kiểm thử ACTIVE bị chặn (Không thể xóa kỳ đang chạy)...');
  {
    const activePeriodId = 'd0000000-0000-0000-0000-000000000002';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by)
      VALUES ('${activePeriodId}', '${classId}', 'Kỳ Đang Chạy Active', 'MONTH', NOW(), NOW() + INTERVAL '30 days', 'ACTIVE', '${teacherOwnerId}');
    `);
    const result = await callDeleteDraft(activePeriodId, teacherOwnerId);
    assert.strictEqual(result.success, false, 'TC4: success false');
    assert.strictEqual(result.status, 'INVALID_STATUS', 'TC4: status INVALID_STATUS');
    const check = await db.query(`SELECT status FROM public.ranking_periods WHERE id = '${activePeriodId}';`);
    assert.strictEqual(check.rows[0]?.status, 'ACTIVE', 'TC4: Active preserved');
  }

  // 8.5 CLOSED bị chặn
  console.log('⏳ [5/7] Kiểm thử CLOSED bị chặn (Không thể xóa kỳ đã đóng)...');
  {
    const closedPeriodId = 'd0000000-0000-0000-0000-000000000003';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by, closed_at)
      VALUES ('${closedPeriodId}', '${classId}', 'Kỳ Lịch Sử Closed', 'MONTH', NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days', 'CLOSED', '${teacherOwnerId}', NOW() - INTERVAL '30 days');
    `);
    const result = await callDeleteDraft(closedPeriodId, teacherOwnerId);
    assert.strictEqual(result.success, false, 'TC5: success false');
    assert.strictEqual(result.status, 'INVALID_STATUS', 'TC5: status INVALID_STATUS');
    const check = await db.query(`SELECT status FROM public.ranking_periods WHERE id = '${closedPeriodId}';`);
    assert.strictEqual(check.rows[0]?.status, 'CLOSED', 'TC5: Closed preserved');
  }

  // 8.6 GV phụ trách xóa DRAFT thành công
  console.log('⏳ [6/7] Kiểm thử GV phụ trách xóa DRAFT thành công...');
  {
    const draftPeriodId = 'd0000000-0000-0000-0000-000000000001';
    const result = await callDeleteDraft(draftPeriodId, teacherOwnerId);
    assert.strictEqual(result.success, true, 'TC6: success true');
    assert.strictEqual(result.status, 'DELETED', 'TC6: status DELETED');
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 0, 'TC6: Record deleted');
  }

  // 8.7 Admin xóa DRAFT thành công
  console.log('⏳ [7/7] Kiểm thử Admin xóa DRAFT thành công...');
  {
    const draftPeriodAdminId = 'd0000000-0000-0000-0000-000000000004';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by)
      VALUES ('${draftPeriodAdminId}', '${classId}', 'Kỳ Nháp Admin Xóa', 'MONTH', NOW(), NOW() + INTERVAL '30 days', 'DRAFT', '${teacherOwnerId}');
    `);
    const result = await callDeleteDraft(draftPeriodAdminId, adminId);
    assert.strictEqual(result.success, true, 'TC7: success true');
    assert.strictEqual(result.status, 'DELETED', 'TC7: status DELETED');
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodAdminId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 0, 'TC7: Record deleted');
  }

  console.log('✅ PGLITE RPC DELETE DRAFT PERIOD PASS');
}

async function main() {
  const startTime = Date.now();
  let sharedDb;
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    // Khởi tạo shared test database 1 lần duy nhất cho toàn bộ 8 suites
    sharedDb = await setupDatabaseWithSchema(PGlite);

    // 1. Suite 1 (Smoke)
    await runSuite1(sharedDb);

    // 2. Suite 2 (Auth stub)
    await runSuite2(sharedDb);

    // 3 - 8. Suites 3..8 trên shared test database
    await runSuite3(sharedDb);
    await runSuite4(sharedDb);
    await runSuite5(sharedDb);
    await runSuite6(sharedDb);
    await runSuite7(sharedDb);
    await runSuite8(sharedDb);
    await sharedDb.close();

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n============================================================`);
    console.log(`⏱ Tổng thời gian chạy: ${elapsedSeconds}s`);
    console.log(`✅ ALL PGLITE ACADEMIC LEADERBOARD & PERIOD TESTS PASS (8/8 Suites)`);
    console.log(`============================================================\n`);
  } catch (err) {
    if (sharedDb) {
      try {
        await sharedDb.close();
      } catch (_) {}
    }
    console.error(`\n❌ RUNNER DỪNG KHẨN CẤP:`, err);
    process.exitCode = 1;
  }
}

main();
