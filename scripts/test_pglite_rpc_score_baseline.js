import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ --liftoff-only kết hợp các cờ V8 tối ưu bộ nhớ
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--wasm-enforce-bounds-checks',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function setupDatabase(PGlite) {
  const db = new PGlite();

  // 1. Roles & auth schema
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

    CREATE OR REPLACE FUNCTION app_private.can_read_class(p_class_id uuid)
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
      IF v_role = 'student' THEN
        RETURN EXISTS (SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = v_uid);
      END IF;
      RETURN FALSE;
    END;
    $$;
  `);

  // 2. DDL tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'student',
      full_name TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      student_code TEXT DEFAULT '',
      total_stars INT DEFAULT 0,
      total_coins INT DEFAULT 0,
      grade_level INT DEFAULT 1,
      is_disabled BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT DEFAULT 'L1A',
      grade_level INT DEFAULT 1,
      teacher_id UUID REFERENCES public.profiles(id)
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES public.classes(id),
      student_id UUID REFERENCES public.profiles(id),
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      grade_level INT DEFAULT 1,
      subject TEXT DEFAULT 'Toán'
    );

    CREATE TABLE IF NOT EXISTS public.student_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id UUID,
      game_id UUID REFERENCES public.games(id),
      student_id UUID REFERENCES public.profiles(id),
      status TEXT DEFAULT 'completed',
      score INT DEFAULT 100,
      stars_earned INT DEFAULT 10,
      completion_time_seconds INT DEFAULT 60,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercises (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'Toán',
      grade_level INT DEFAULT 1,
      status TEXT DEFAULT 'published',
      class_id UUID REFERENCES public.classes(id),
      teacher_id UUID REFERENCES public.profiles(id),
      due_date TIMESTAMPTZ,
      reward_stars INT DEFAULT 10,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID REFERENCES public.academic_exercises(id),
      class_id UUID REFERENCES public.classes(id),
      assigned_by UUID REFERENCES public.profiles(id),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      due_date TIMESTAMPTZ,
      counts_toward_ranking BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID REFERENCES public.academic_exercises(id),
      question_number INT DEFAULT 1,
      question_type TEXT DEFAULT 'single_choice',
      prompt TEXT DEFAULT '1+1=?',
      points INT DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS public.academic_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID REFERENCES public.academic_exercises(id),
      student_id UUID REFERENCES public.profiles(id),
      attempt_number INT DEFAULT 1,
      status TEXT DEFAULT 'graded',
      objective_score INT DEFAULT 10,
      manual_score INT DEFAULT 0,
      total_score INT DEFAULT 10,
      max_score INT DEFAULT 10,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      graded_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ranking_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES public.classes(id),
      name TEXT NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'WEEK',
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'DRAFT' NOT NULL,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_by UUID,
      closed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES public.ranking_periods(id),
      class_id UUID REFERENCES public.classes(id),
      student_id UUID REFERENCES public.profiles(id),
      delta_stars INT NOT NULL,
      reason TEXT NOT NULL,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES public.ranking_periods(id),
      class_id UUID REFERENCES public.classes(id),
      student_id UUID REFERENCES public.profiles(id),
      subject TEXT DEFAULT 'ALL' NOT NULL,
      game_stars INT DEFAULT 0,
      game_rank INT DEFAULT 0,
      game_completed_count INT DEFAULT 0,
      academic_score_pct NUMERIC(5,1) DEFAULT 0.0,
      academic_rank INT DEFAULT 0,
      academic_completed_count INT DEFAULT 0,
      academic_assigned_count INT DEFAULT 0,
      completion_rate_pct NUMERIC(5,1) DEFAULT 0.0,
      avg_score_pct NUMERIC(5,1) DEFAULT 0.0,
      total_earned_score NUMERIC(7,1) DEFAULT 0.0,
      class_max_score NUMERIC(7,1) DEFAULT 0.0,
      snapshot_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT unique_period_student_subject UNIQUE (period_id, student_id, subject)
    );
  `);

  // 3. Nạp SQL Migration ADD_SCORE_RANKING_BASELINE.sql
  const sqlPath = path.resolve(__dirname, '../ADD_SCORE_RANKING_BASELINE.sql');
  const sqlContent = await fs.readFile(sqlPath, 'utf8');
  await db.exec(sqlContent);

  return db;
}

async function runTests() {
  console.log('🚀 BẮT ĐẦU BỘ TEST PGLITE CHO CHỨC NĂNG SCORE RANKING BASELINE (RESET ĐIỂM V1)...');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = await setupDatabase(PGlite);

  // Fixtures UUID
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222222';
  const teacher2Id = '33333333-3333-3333-3333-333333333333';
  const student1Id = '44444444-4444-4444-4444-444444444444';
  const student2Id = '55555555-5555-5555-5555-555555555555';
  const student3Id = '66666666-6666-6666-6666-666666666666';

  const class1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // GV1
  const class2Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // GV2

  const game1Id = '71111111-1111-1111-1111-111111111111';
  const exercise1Id = '81111111-1111-1111-1111-111111111111';
  const exercise2Id = '82222222-2222-2222-2222-222222222222';

  // Seed Data
  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name, total_stars, total_coins, grade_level) VALUES
      ('${adminId}', 'admin', 'Admin Hệ Thống', 0, 0, 1),
      ('${teacher1Id}', 'teacher', 'Cô Giáo 1', 0, 0, 1),
      ('${teacher2Id}', 'teacher', 'Cô Giáo 2', 0, 0, 1),
      ('${student1Id}', 'student', 'Học Sinh A', 100, 50, 1),
      ('${student2Id}', 'student', 'Học Sinh B', 80, 40, 1),
      ('${student3Id}', 'student', 'Học Sinh C (Lớp 2)', 50, 20, 1);

    INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
      ('${class1Id}', 'Lớp 1A', 1, '${teacher1Id}'),
      ('${class2Id}', 'Lớp 1B', 1, '${teacher2Id}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class1Id}', '${student1Id}'),
      ('${class1Id}', '${student2Id}'),
      ('${class2Id}', '${student3Id}');

    INSERT INTO public.games (id, title, grade_level, subject) VALUES
      ('${game1Id}', 'Toán Vui Khối 1', 1, 'Toán');

    INSERT INTO public.academic_exercises (id, title, subject, grade_level, status, class_id, teacher_id) VALUES
      ('${exercise1Id}', 'Bài Tập Toán Tuần 1', 'Toán', 1, 'published', '${class1Id}', '${teacher1Id}'),
      ('${exercise2Id}', 'Bài Tập Toán Tuần 2', 'Toán', 1, 'published', '${class1Id}', '${teacher1Id}');

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
      ('${exercise1Id}', '${class1Id}', '${teacher1Id}', '2026-09-05 08:00:00+07', true),
      ('${exercise2Id}', '${class1Id}', '${teacher1Id}', '2026-10-05 08:00:00+07', true);

    INSERT INTO public.academic_exercise_questions (exercise_id, question_number, points) VALUES
      ('${exercise1Id}', 1, 10),
      ('${exercise2Id}', 1, 10);

    -- Dữ liệu game cũ (tháng 9)
    INSERT INTO public.student_progress (game_id, student_id, score, stars_earned, completed_at) VALUES
      ('${game1Id}', '${student1Id}', 100, 30, '2026-09-10 10:00:00+07'),
      ('${game1Id}', '${student2Id}', 100, 20, '2026-09-10 10:00:00+07');

    -- Dữ liệu game mới (tháng 10)
    INSERT INTO public.student_progress (game_id, student_id, score, stars_earned, completed_at) VALUES
      ('${game1Id}', '${student1Id}', 100, 50, '2026-10-10 10:00:00+07'),
      ('${game1Id}', '${student2Id}', 100, 40, '2026-10-10 10:00:00+07');

    -- Dữ liệu bài nộp cũ (tháng 9)
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise1Id}', '${student1Id}', 'graded', 10, 10, 10, '2026-09-15 14:00:00+07'),
      ('${exercise1Id}', '${student2Id}', 'graded', 8, 8, 10, '2026-09-15 14:00:00+07');

    -- Dữ liệu bài nộp mới (tháng 10)
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise2Id}', '${student1Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07'),
      ('${exercise2Id}', '${student2Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07');
  `);

  console.log('✅ Seed dữ liệu khởi tạo thành công.');

  // =========================================================================
  // TEST 1: PREVIEW KHÔNG GHI DB & TÍNH ĐÚNG TÁC ĐỘNG
  // =========================================================================
  console.log('\n--- TEST 1: PREVIEW KHÔNG GHI DB ---');
  await db.exec(`SET app.current_user_id = '${adminId}';`);
  const prevRes = await db.query(`
    SELECT public.preview_score_baseline_reset(
      '${class1Id}',
      ARRAY['${student1Id}']::UUID[],
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL
    ) AS res;
  `);
  const pJson = prevRes.rows[0].res;
  assert.strictEqual(pJson.success, true, 'Preview thành công');
  assert.strictEqual(pJson.student_count, 1, '1 học sinh');
  assert.strictEqual(pJson.affected_games_count, 1, '1 lượt game cũ');
  assert.strictEqual(pJson.affected_game_stars, 30, '30 sao cũ');
  assert.strictEqual(pJson.affected_submissions_count, 1, '1 bài nộp cũ');

  const checkDb = await db.query(`SELECT COUNT(*)::INT AS cnt FROM public.student_score_baselines;`);
  assert.strictEqual(checkDb.rows[0].cnt, 0, 'DB không được ghi bản ghi nào sau preview');
  console.log('✅ TEST 1 PASS: Preview thành công, không ghi DB.');

  // =========================================================================
  // TEST 2: PHÂN QUYỀN - TEACHER BỊ CHẶN LỚP KHÁC, STUDENT BỊ CHẶN
  // =========================================================================
  console.log('\n--- TEST 2: PHÂN QUYỀN TEACHER & STUDENT ---');
  // Teacher 2 cố gắng reset Lớp 1 -> Phải bị từ chối
  await db.exec(`SET app.current_user_id = '${teacher2Id}';`);
  const t2Res = await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      NULL,
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL,
      'Reset test'
    ) AS res;
  `);
  assert.strictEqual(t2Res.rows[0].res.success, false, 'Teacher 2 không thể reset Lớp 1');

  // Student cố gắng reset -> Phải bị từ chối
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const stRes = await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      NULL,
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL,
      'Reset test'
    ) AS res;
  `);
  assert.strictEqual(stRes.rows[0].res.success, false, 'Student không thể reset');
  console.log('✅ TEST 2 PASS: Teacher trái lớp và Student bị chặn triệt để.');

  // =========================================================================
  // TEST 3: TEACHER 1 ÁP DỤNG MỐC MỚI CHO LỚP 1 (CUTOFF TỪ 01/10/2026)
  // =========================================================================
  console.log('\n--- TEST 3: TEACHER 1 ÁP DỤNG BASELINE ---');
  await db.exec(`SET app.current_user_id = '${teacher1Id}';`);
  const applyRes = await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      ARRAY['${student1Id}', '${student2Id}']::UUID[],
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL,
      'Bắt đầu đợt thi đua tháng 10'
    ) AS res;
  `);
  const applyJson = applyRes.rows[0].res;
  assert.strictEqual(applyJson.success, true, 'Apply thành công');
  assert.strictEqual(applyJson.created_count, 2, 'Tạo 2 baseline cho 2 học sinh');

  // Kiểm tra dữ liệu thô KHÔNG BỊ XÓA
  const spCount = await db.query(`SELECT COUNT(*)::INT AS cnt FROM public.student_progress;`);
  const asCount = await db.query(`SELECT COUNT(*)::INT AS cnt FROM public.academic_submissions;`);
  assert.strictEqual(spCount.rows[0].cnt, 4, 'Dữ liệu student_progress giữ nguyên 100%');
  assert.strictEqual(asCount.rows[0].cnt, 4, 'Dữ liệu academic_submissions giữ nguyên 100%');
  console.log('✅ TEST 3 PASS: Apply thành công, bảo toàn 100% dữ liệu gốc.');

  // =========================================================================
  // TEST 4: BẢNG XẾP HẠNG GAME & HỌC THUẬT PHẢN ÁNH MỐC CUTOFF
  // =========================================================================
  console.log('\n--- TEST 4: LEADERBOARD PHẢN ÁNH MỐC CUTOFF ---');
  // Leaderboard Game lớp 1A:
  const gameLbRes = await db.query(`
    SELECT public.get_game_leaderboard('1', '${class1Id}') AS res;
  `);
  const gLb = gameLbRes.rows[0].res.leaderboard;
  // Student 1: Tháng 10 có 50 sao (tháng 9 có 30 sao bị cutoff) -> Phải = 50 sao
  const s1Game = gLb.find(s => s.student_id === student1Id);
  assert.strictEqual(Number(s1Game.total_stars), 50, 'Student 1 chỉ tính 50 sao sau mốc 01/10');

  // Student 2: Tháng 10 có 40 sao (tháng 9 có 20 sao bị cutoff) -> Phải = 40 sao
  const s2Game = gLb.find(s => s.student_id === student2Id);
  assert.strictEqual(Number(s2Game.total_stars), 40, 'Student 2 chỉ tính 40 sao sau mốc 01/10');
  console.log('✅ TEST 4 PASS: Game Leaderboard phản ánh chuẩn xác mốc cutoff.');

  // =========================================================================
  // TEST 5: KỲ XẾP HẠNG CLOSED BẤT BIẾN VS ACTIVE PHẢN ÁNH BASELINE
  // =========================================================================
  console.log('\n--- TEST 5: KỲ CLOSED BẤT BIẾN VS ACTIVE ---');
  const activePeriodId = '99999999-9999-9999-9999-999999999999';
  const closedPeriodId = '88888888-8888-8888-8888-888888888888';

  await db.exec(`
    INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by) VALUES
      ('${activePeriodId}', '${class1Id}', 'Kỳ Đang Chạy Tháng 9-10', 'MONTH', '2026-09-01 00:00:00+07', '2026-10-31 23:59:59+07', 'ACTIVE', '${teacher1Id}'),
      ('${closedPeriodId}', '${class1Id}', 'Kỳ Đã Đóng Tháng 9', 'MONTH', '2026-09-01 00:00:00+07', '2026-09-30 23:59:59+07', 'CLOSED', '${teacher1Id}');

    -- Snapshot bất biến cho kỳ CLOSED: Student 1 có 30 sao
    INSERT INTO public.ranking_period_results (period_id, class_id, student_id, subject, game_stars, game_rank, game_completed_count) VALUES
      ('${closedPeriodId}', '${class1Id}', '${student1Id}', 'ALL', 30, 1, 1),
      ('${closedPeriodId}', '${class1Id}', '${student2Id}', 'ALL', 20, 2, 1);
  `);

  // Kỳ CLOSED: Đọc snapshot vẫn nguyên 30 sao
  const closedRes = await db.query(`SELECT public.get_game_period_leaderboard('${closedPeriodId}') AS res;`);
  const cData = closedRes.rows[0].res;
  const s1Closed = cData.find(s => s.student_id === student1Id);
  assert.strictEqual(Number(s1Closed.period_stars), 30, 'Kỳ CLOSED bất biến, vẫn là 30 sao snapshot cũ');

  // Kỳ ACTIVE: Có baseline 01/10 -> Chỉ tính 50 sao tháng 10
  const activeRes = await db.query(`SELECT public.get_game_period_leaderboard('${activePeriodId}') AS res;`);
  const aData = activeRes.rows[0].res;
  const s1Active = aData.find(s => s.student_id === student1Id);
  assert.strictEqual(Number(s1Active.period_stars), 50, 'Kỳ ACTIVE loại bỏ sao tháng 9, chỉ còn 50 sao');
  console.log('✅ TEST 5 PASS: Kỳ CLOSED giữ nguyên bất biến, kỳ ACTIVE phản ánh baseline.');

  // =========================================================================
  // TEST 6: HOÀN TÁC / UNDO (REVOKE) BASELINE KHÔI PHỤC ĐIỂM CŨ
  // =========================================================================
  console.log('\n--- TEST 6: UNDO / REVOKE BASELINE ---');
  const baselinesList = await db.query(`
    SELECT public.get_class_score_baselines('${class1Id}') AS res;
  `);
  const bls = baselinesList.rows[0].res.baselines;
  assert.strictEqual(bls.length, 2, 'Có 2 baseline đang active');

  // Thu hồi baseline của Student 1
  const b1 = bls.find(b => b.student_id === student1Id);
  const revokeRes = await db.query(`
    SELECT public.admin_teacher_revoke_score_baseline('${b1.id}', 'Hủy để kiểm tra rollback') AS res;
  `);
  assert.strictEqual(revokeRes.rows[0].res.success, true, 'Revoke thành công');

  // Sau khi Revoke: Leaderboard Game của Student 1 phải khôi phục lại (tính tổng sao profile = 100)
  const gameLbAfterRevoke = await db.query(`
    SELECT public.get_game_leaderboard('1', '${class1Id}') AS res;
  `);
  const s1After = gameLbAfterRevoke.rows[0].res.leaderboard.find(s => s.student_id === student1Id);
  assert.strictEqual(Number(s1After.total_stars), 100, 'Student 1 phục hồi 100 sao sau khi Undo');
  console.log('✅ TEST 6 PASS: Undo phục hồi điểm số nguyên vẹn.');

  // =========================================================================
  // TEST 7: PHẠM VI THỜI GIAN NỬA KHOẢNG (START INCLUSIVE, END EXCLUSIVE)
  // =========================================================================
  console.log('\n--- TEST 7: RANH GIỚI THỜI GIAN START INCLUSIVE, END EXCLUSIVE ---');
  // Áp dụng baseline reset chỉ trong Tháng 9: [2026-09-01 00:00:00+07, 2026-10-01 00:00:00+07)
  await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      ARRAY['${student1Id}']::UUID[],
      'game',
      '2026-09-01 00:00:00+07'::TIMESTAMPTZ,
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      'Reset riêng tháng 9'
    );
  `);

  const gameLbRange = await db.query(`
    SELECT public.get_game_leaderboard('1', '${class1Id}') AS res;
  `);
  const s1Range = gameLbRange.rows[0].res.leaderboard.find(s => s.student_id === student1Id);
  // Tháng 9 (30 sao) bị loại trừ, tháng 10 (50 sao) nằm ngoài window nên được giữ -> 50 sao
  assert.strictEqual(Number(s1Range.total_stars), 50, 'Chỉ loại trừ event trong [start, end)');
  console.log('✅ TEST 7 PASS: Ranh giới nửa khoảng chuẩn xác.');

  console.log('\n🎉 TẤT CẢ CÁC TEST CASES ĐÃ PASS 100% VÀ KHẲNG ĐỊNH TÍNH ĐÚNG ĐẮN CỦA HỆ THỐNG!');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
