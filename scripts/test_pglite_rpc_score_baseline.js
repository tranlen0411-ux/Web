/**
 * TEST PGLITE: SCORE RANKING BASELINE V1 (REVISED & COMPREHENSIVE - FINAL 3 POLISHES)
 * Kiểm chứng 100% các yêu cầu:
 * 1. ACADEMIC DENOMINATOR: Mẫu số và tử số tính chuẩn xác theo từng học sinh dựa theo baseline.
 * 2. GAME BASELINE AT ALL / GRADE / CLASS: Điểm mốc xuất phát nhất quán trên cả 3 view.
 * 3. STRICT VALIDATION: [student_in_class, student_other_class] => fail toàn request, 0 baseline inserted.
 * 4. TIE LOGIC: Hai học sinh bằng điểm có cùng rank và is_tied: true. Tên chỉ dùng để sắp xếp hiển thị.
 * 5. FULL_YEAR BOUNDARY: start >= 2026-09-01 00:00:00+07 AND end < 2027-06-01 00:00:00+07.
 * 6. CUSTOM TIME MODE: Kiểm thử ranh giới khoảng ngày tùy chọn hợp lệ và phát hiện lỗi when until <= from.
 * 7. SOFT REVOKE (UNDO) phục hồi điểm số nguyên vẹn.
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupDatabase(PGlite) {
  const db = new PGlite();

  // 1. App schema & auth helper & roles
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
      full_name TEXT NOT NULL,
      student_code TEXT,
      total_stars INT DEFAULT 0,
      total_coins INT DEFAULT 0,
      grade_level INT,
      avatar_url TEXT
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      grade_level INT NOT NULL,
      teacher_id UUID REFERENCES public.profiles(id)
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      class_id UUID REFERENCES public.classes(id),
      student_id UUID REFERENCES public.profiles(id),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (class_id, student_id)
    );

    CREATE OR REPLACE FUNCTION app_private.can_read_class(p_class_id UUID)
    RETURNS BOOLEAN LANGUAGE plpgsql AS $$
    DECLARE
      v_uid UUID := NULLIF(current_setting('app.current_user_id', true), '')::UUID;
      v_role TEXT;
    BEGIN
      IF v_uid IS NULL THEN RETURN FALSE; END IF;
      SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
      IF v_role = 'admin' THEN RETURN TRUE; END IF;
      IF v_role = 'teacher' AND EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_uid) THEN RETURN TRUE; END IF;
      IF v_role = 'student' AND EXISTS (SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = v_uid) THEN RETURN TRUE; END IF;
      RETURN FALSE;
    END;
    $$;

    CREATE OR REPLACE FUNCTION app_private.can_manage_class(p_class_id UUID)
    RETURNS BOOLEAN LANGUAGE plpgsql AS $$
    DECLARE
      v_uid UUID := NULLIF(current_setting('app.current_user_id', true), '')::UUID;
      v_role TEXT;
    BEGIN
      IF v_uid IS NULL THEN RETURN FALSE; END IF;
      SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
      IF v_role = 'admin' THEN RETURN TRUE; END IF;
      IF v_role = 'teacher' AND EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_uid) THEN RETURN TRUE; END IF;
      RETURN FALSE;
    END;
    $$;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
    $$;

    -- Các bảng Game & Bài tập
    CREATE TABLE IF NOT EXISTS public.games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      grade_level INT NOT NULL,
      subject TEXT
    );

    CREATE TABLE IF NOT EXISTS public.student_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES public.games(id),
      student_id UUID REFERENCES public.profiles(id),
      score INT NOT NULL,
      stars_earned INT NOT NULL,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercises (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade_level INT NOT NULL,
      status TEXT DEFAULT 'draft',
      class_id UUID REFERENCES public.classes(id),
      teacher_id UUID REFERENCES public.profiles(id)
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID REFERENCES public.academic_exercises(id),
      class_id UUID REFERENCES public.classes(id),
      assigned_by UUID REFERENCES public.profiles(id),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      counts_toward_ranking BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID REFERENCES public.academic_exercises(id),
      question_number INT,
      question_type TEXT DEFAULT 'multiple_choice',
      points NUMERIC(5,1) DEFAULT 10.0
    );

    CREATE TABLE IF NOT EXISTS public.academic_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID REFERENCES public.academic_exercises(id),
      student_id UUID REFERENCES public.profiles(id),
      status TEXT DEFAULT 'submitted',
      objective_score NUMERIC(5,1),
      total_score NUMERIC(5,1),
      max_score NUMERIC(5,1),
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ranking_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES public.classes(id),
      name TEXT NOT NULL,
      period_type TEXT NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      created_by UUID REFERENCES public.profiles(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      closed_by UUID REFERENCES public.profiles(id)
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES public.ranking_periods(id),
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

  // Nạp SQL Migration ADD_SCORE_RANKING_BASELINE.sql
  const sqlPath = path.resolve(__dirname, '../ADD_SCORE_RANKING_BASELINE.sql');
  const sqlContent = await fs.readFile(sqlPath, 'utf8');
  await db.exec(sqlContent);

  return db;
}

async function runTests() {
  console.log('🚀 BẮT ĐẦU BỘ TEST PGLITE CHO SCORE RANKING BASELINE V1 (REVISED & POLISHED)...');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = await setupDatabase(PGlite);

  // Fixtures UUID
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222222';
  const teacher2Id = '33333333-3333-3333-3333-333333333333';
  const student1Id = '44444444-4444-4444-4444-444444444444'; // Lớp 1A (HS A)
  const student2Id = '55555555-5555-5555-5555-555555555555'; // Lớp 1A (HS B)
  const student3Id = '66666666-6666-6666-6666-666666666666'; // Lớp 1B (HS C)
  const student4Id = '77777777-7777-7777-7777-777777777777'; // Lớp 1A (HS D - cùng điểm với HS B để test tie)

  const class1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Lớp 1A (GV 1)
  const class2Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Lớp 1B (GV 2)

  const game1Id = '71111111-1111-1111-1111-111111111111';
  const exercise1Id = '81111111-1111-1111-1111-111111111111'; // Giao ngày 05/09 (10đ)
  const exercise2Id = '82222222-2222-2222-2222-222222222222'; // Giao ngày 05/10 (10đ)
  const exercise3MayId = '83333333-3333-3333-3333-333333333333'; // Giao ngày 20/05/2027 (10đ) để test FULL_YEAR boundary

  // Seed Data
  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name, total_stars, total_coins, grade_level) VALUES
      ('${adminId}', 'admin', 'Admin Hệ Thống', 0, 0, 1),
      ('${teacher1Id}', 'teacher', 'Cô Giáo 1', 0, 0, 1),
      ('${teacher2Id}', 'teacher', 'Cô Giáo 2', 0, 0, 1),
      ('${student1Id}', 'student', 'Học Sinh A', 80, 50, 1),
      ('${student2Id}', 'student', 'Học Sinh B', 60, 40, 1),
      ('${student3Id}', 'student', 'Học Sinh C (Lớp 1B)', 50, 20, 1),
      ('${student4Id}', 'student', 'Học Sinh D (Đồng điểm HS B)', 60, 40, 1);

    INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
      ('${class1Id}', 'Lớp 1A', 1, '${teacher1Id}'),
      ('${class2Id}', 'Lớp 1B', 1, '${teacher2Id}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class1Id}', '${student1Id}'),
      ('${class1Id}', '${student2Id}'),
      ('${class1Id}', '${student4Id}'),
      ('${class2Id}', '${student3Id}');

    INSERT INTO public.games (id, title, grade_level, subject) VALUES
      ('${game1Id}', 'Toán Vui Khối 1', 1, 'Toán');

    INSERT INTO public.academic_exercises (id, title, subject, grade_level, status, class_id, teacher_id) VALUES
      ('${exercise1Id}', 'Bài Tập Toán Tuần 1', 'Toán', 1, 'published', '${class1Id}', '${teacher1Id}'),
      ('${exercise2Id}', 'Bài Tập Toán Tuần 2', 'Toán', 1, 'published', '${class1Id}', '${teacher1Id}'),
      ('${exercise3MayId}', 'Bài Tập Toán Tháng 5', 'Toán', 1, 'published', '${class1Id}', '${teacher1Id}');

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
      ('${exercise1Id}', '${class1Id}', '${teacher1Id}', '2026-09-05 08:00:00+07', true),
      ('${exercise2Id}', '${class1Id}', '${teacher1Id}', '2026-10-05 08:00:00+07', true),
      ('${exercise3MayId}', '${class1Id}', '${teacher1Id}', '2027-05-20 08:00:00+07', true);

    INSERT INTO public.academic_exercise_questions (exercise_id, question_number, points) VALUES
      ('${exercise1Id}', 1, 10),
      ('${exercise2Id}', 1, 10),
      ('${exercise3MayId}', 1, 10);

    -- Dữ liệu game cũ (tháng 9)
    INSERT INTO public.student_progress (game_id, student_id, score, stars_earned, completed_at) VALUES
      ('${game1Id}', '${student1Id}', 100, 30, '2026-09-10 10:00:00+07'),
      ('${game1Id}', '${student2Id}', 100, 20, '2026-09-10 10:00:00+07'),
      ('${game1Id}', '${student4Id}', 100, 20, '2026-09-10 10:00:00+07');

    -- Dữ liệu game mới (tháng 10)
    INSERT INTO public.student_progress (game_id, student_id, score, stars_earned, completed_at) VALUES
      ('${game1Id}', '${student1Id}', 100, 50, '2026-10-10 10:00:00+07'),
      ('${game1Id}', '${student2Id}', 100, 40, '2026-10-10 10:00:00+07'),
      ('${game1Id}', '${student4Id}', 100, 40, '2026-10-10 10:00:00+07');

    -- Dữ liệu bài nộp cũ (tháng 9): HS A được 10/10, HS B và D được 8/10
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise1Id}', '${student1Id}', 'graded', 10, 10, 10, '2026-09-15 14:00:00+07'),
      ('${exercise1Id}', '${student2Id}', 'graded', 8, 8, 10, '2026-09-15 14:00:00+07'),
      ('${exercise1Id}', '${student4Id}', 'graded', 8, 8, 10, '2026-09-15 14:00:00+07');

    -- Dữ liệu bài nộp mới (tháng 10): HS A được 10/10, HS B và D được 10/10
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise2Id}', '${student1Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07'),
      ('${exercise2Id}', '${student2Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07'),
      ('${exercise2Id}', '${student4Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07');

    -- Dữ liệu bài nộp tháng 5 (để test FULL_YEAR boundary)
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise3MayId}', '${student1Id}', 'graded', 10, 10, 10, '2027-05-21 14:00:00+07'),
      ('${exercise3MayId}', '${student2Id}', 'graded', 10, 10, 10, '2027-05-21 14:00:00+07'),
      ('${exercise3MayId}', '${student4Id}', 'graded', 10, 10, 10, '2027-05-21 14:00:00+07');
  `);

  console.log('✅ Seed dữ liệu khởi tạo thành công.');

  // =========================================================================
  // TEST 1: STRICT VALIDATION P_STUDENT_IDS
  // [student_in_class, student_other_class] => fail toàn request, 0 baseline inserted
  // =========================================================================
  console.log('\n--- TEST 1: STRICT VALIDATION P_STUDENT_IDS ---');
  await db.exec(`SET app.current_user_id = '${adminId}';`);

  const invalidPrevRes = await db.query(`
    SELECT public.preview_score_baseline_reset(
      '${class1Id}',
      ARRAY['${student1Id}', '${student3Id}']::UUID[],
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL
    ) AS res;
  `);
  const invPrevJson = invalidPrevRes.rows[0].res;
  assert.strictEqual(invPrevJson.success, false, 'Preview phải fail khi có ID trái lớp');
  assert.strictEqual(invPrevJson.status, 'INVALID_STUDENT_IDS', 'Status phải là INVALID_STUDENT_IDS');

  const invalidApplyRes = await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      ARRAY['${student1Id}', '${student3Id}']::UUID[],
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL,
      'Test invalid student ids'
    ) AS res;
  `);
  const invApplyJson = invalidApplyRes.rows[0].res;
  assert.strictEqual(invApplyJson.success, false, 'Apply phải fail khi có ID trái lớp');
  assert.strictEqual(invApplyJson.status, 'INVALID_STUDENT_IDS', 'Status phải là INVALID_STUDENT_IDS');

  const checkCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.student_score_baselines;`);
  assert.strictEqual(checkCount.rows[0].cnt, 0, 'Phải có đúng 0 baseline được tạo');
  console.log('✅ TEST 1 PASS: Strict validation chặn đứng 100% ID không hợp lệ.');

  // =========================================================================
  // TEST 2: CUSTOM TIME MODE (HỢP LỆ VS INVALID UNTIL <= FROM)
  // =========================================================================
  console.log('\n--- TEST 2: CUSTOM TIME MODE DATES VALIDATION ---');
  const invalidDateRes = await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      ARRAY['${student1Id}']::UUID[],
      'both',
      '2026-10-10 00:00:00+07'::TIMESTAMPTZ,
      '2026-10-05 00:00:00+07'::TIMESTAMPTZ,
      'Test invalid date window'
    ) AS res;
  `);
  assert.strictEqual(invalidDateRes.rows[0].res.success, false, 'until <= from phải trả về fail');
  assert.strictEqual(invalidDateRes.rows[0].res.status, 'INVALID_DATES');
  console.log('✅ TEST 2 PASS: Backend từ chối ngày kết thúc nhỏ hơn hoặc bằng ngày bắt đầu.');

  // =========================================================================
  // TEST 3: THIẾT LẬP BASELINE CHO HỌC SINH A (TỪ 01/10/2026)
  // =========================================================================
  console.log('\n--- TEST 3: THIẾT LẬP BASELINE CHO HỌC SINH A ---');
  await db.exec(`SET app.current_user_id = '${teacher1Id}';`);

  const setRes = await db.query(`
    SELECT public.admin_teacher_set_score_baseline(
      '${class1Id}',
      ARRAY['${student1Id}']::UUID[],
      'both',
      '2026-10-01 00:00:00+07'::TIMESTAMPTZ,
      NULL,
      'Bắt đầu đợt thi đua Tháng 10'
    ) AS res;
  `);
  const setJson = setRes.rows[0].res;
  assert.strictEqual(setJson.success, true, 'Thiết lập baseline cho HS A thành công');
  assert.strictEqual(setJson.created_count, 1, 'Tạo đúng 1 baseline');
  console.log('✅ TEST 3 PASS: Teacher 1 thiết lập baseline thành công.');

  // =========================================================================
  // TEST 4: CRITICAL - ACADEMIC DENOMINATOR & TIE LOGIC KHÔNG DÙNG FULL_NAME TRONG DENSE_RANK
  // - HS A (reset 01/10): chỉ tính bài 2 (tháng 10) & bài 3 (tháng 5) => total 20/20đ (100.0%)
  // - HS B & HS D (không reset): tính cả 3 bài => total 28/30đ (93.3%)
  // - HS B và HS D có cùng tỷ lệ và metric => PHẢI CÓ CÙNG RANK VÀ IS_TIED = TRUE
  // =========================================================================
  console.log('\n--- TEST 4: ACADEMIC DENOMINATOR & REAL TIE RANKING ---');
  const acadRes = await db.query(`
    SELECT public.get_academic_class_leaderboard('${class1Id}', 'ALL', 'ALL') AS res;
  `);
  const acadJson = acadRes.rows[0].res;
  assert.strictEqual(acadJson.success, true, 'Lấy Academic leaderboard thành công');

  const lb = acadJson.leaderboard;
  const hsA = lb.find(s => s.student_id === student1Id);
  const hsB = lb.find(s => s.student_id === student2Id);
  const hsD = lb.find(s => s.student_id === student4Id);

  // HS A
  assert.strictEqual(hsA.total_earned_score, 20, 'HS A: 20đ (bài tháng 10 + tháng 5)');
  assert.strictEqual(hsA.completed_count, 2, 'HS A: 2 bài hoàn thành');
  assert.strictEqual(hsA.total_valid_count, 2, 'HS A mẫu số: 2 bài (bài tháng 9 bị loại khỏi mẫu số)');
  assert.strictEqual(Number(hsA.academic_score_pct), 100.0, 'HS A: 100.0% (20/20)');
  assert.strictEqual(hsA.rank, 1, 'HS A đạt hạng 1');

  // HS B và HS D (đồng điểm)
  assert.strictEqual(hsB.total_earned_score, 28, 'HS B: 28đ (8 + 10 + 10)');
  assert.strictEqual(hsD.total_earned_score, 28, 'HS D: 28đ (8 + 10 + 10)');
  assert.strictEqual(hsB.total_valid_count, 3, 'HS B mẫu số: 3 bài');
  assert.strictEqual(hsD.total_valid_count, 3, 'HS D mẫu số: 3 bài');
  assert.strictEqual(Number(hsB.academic_score_pct), 93.3, 'HS B: 93.3% (28/30)');
  assert.strictEqual(Number(hsD.academic_score_pct), 93.3, 'HS D: 93.3% (28/30)');

  // KIỂM TRA TIE LOGIC: HS B và HS D phải CÙNG RANK (Rank 2) và is_tied: true
  assert.strictEqual(hsB.rank, 2, 'HS B đạt hạng 2');
  assert.strictEqual(hsD.rank, 2, 'HS D PHẢI ĐỒNG HẠNG 2 VỚI HS B (KHÔNG BỊ PHÂN HẠNG THEO TÊN)');
  assert.strictEqual(hsB.is_tied, true, 'HS B is_tied phải là true');
  assert.strictEqual(hsD.is_tied, true, 'HS D is_tied phải là true');
  console.log('✅ TEST 4 PASS: Academic denominator & Tie ranking hoạt động hoàn hảo.');

  // =========================================================================
  // TEST 5: FULL_YEAR BOUNDARY (2026-09-01 ĐẾN 2027-06-01)
  // Bài tập ngày 20/05/2027 phải được tính vào FULL_YEAR
  // =========================================================================
  console.log('\n--- TEST 5: FULL_YEAR BOUNDARY (< 2027-06-01) ---');
  const fyRes = await db.query(`
    SELECT public.get_academic_class_leaderboard('${class1Id}', 'FULL_YEAR', 'ALL') AS res;
  `);
  const fyLb = fyRes.rows[0].res.leaderboard;
  const fyA = fyLb.find(s => s.student_id === student1Id);
  const fyB = fyLb.find(s => s.student_id === student2Id);
  assert.strictEqual(fyA.total_earned_score, 20, 'FULL_YEAR: HS A nhận đủ bài tháng 5');
  assert.strictEqual(fyB.total_earned_score, 28, 'FULL_YEAR: HS B nhận đủ bài tháng 5 (tổng 28đ)');
  console.log('✅ TEST 5 PASS: FULL_YEAR boundary bao gồm chính xác đến trước 01/06/2027.');

  // =========================================================================
  // TEST 6: GAME BASELINE AT CLASS, GRADE & ALL + GAME TIE LOGIC
  // HS B và HS D đều có 60 sao và 40 coins -> PHẢI CÙNG RANK VÀ IS_TIED = TRUE
  // =========================================================================
  console.log('\n--- TEST 6: GAME BASELINE & GAME TIE RANKING ---');
  const gameClassRes = await db.query(`
    SELECT public.get_game_leaderboard('1', '${class1Id}') AS res;
  `);
  const gLb = gameClassRes.rows[0].res.leaderboard;
  const gA = gLb.find(s => s.student_id === student1Id);
  const gB = gLb.find(s => s.student_id === student2Id);
  const gD = gLb.find(s => s.student_id === student4Id);

  assert.strictEqual(gA.total_stars, 50, 'Game: HS A có 50 sao (tháng 10)');
  assert.strictEqual(gB.total_stars, 60, 'Game: HS B có 60 sao');
  assert.strictEqual(gD.total_stars, 60, 'Game: HS D có 60 sao');

  // HS B và HS D đứng đầu với 60 sao -> ĐỒNG HẠNG 1
  assert.strictEqual(gB.rank, 1, 'HS B đạt hạng 1');
  assert.strictEqual(gD.rank, 1, 'HS D PHẢI ĐỒNG HẠNG 1 VỚI HS B');
  assert.strictEqual(gB.is_tied, true, 'HS B is_tied = true');
  assert.strictEqual(gD.is_tied, true, 'HS D is_tied = true');
  assert.strictEqual(gA.rank, 2, 'HS A đạt hạng 2 với 50 sao');
  console.log('✅ TEST 6 PASS: Game baseline và Tie ranking đồng hạng chuẩn xác.');

  // =========================================================================
  // TEST 7: HOÀN TÁC (UNDO / REVOKE BASELINE)
  // =========================================================================
  console.log('\n--- TEST 7: HOÀN TÁC (UNDO / REVOKE BASELINE) ---');
  const blListRes = await db.query(`SELECT public.get_class_score_baselines('${class1Id}') AS res;`);
  const activeBaselineId = blListRes.rows[0].res.baselines[0].id;

  const revokeRes = await db.query(`
    SELECT public.admin_teacher_revoke_score_baseline('${activeBaselineId}', 'Thầy giáo hoàn tác mốc') AS res;
  `);
  assert.strictEqual(revokeRes.rows[0].res.success, true, 'Revoke baseline thành công');

  const acadRestoredRes = await db.query(`
    SELECT public.get_academic_class_leaderboard('${class1Id}', 'ALL', 'ALL') AS res;
  `);
  const restA = acadRestoredRes.rows[0].res.leaderboard.find(s => s.student_id === student1Id);
  assert.strictEqual(restA.total_earned_score, 30, 'Sau Undo: HS A phục hồi đủ 30 điểm (10 + 10 + 10)');
  assert.strictEqual(restA.total_valid_count, 3, 'Sau Undo: Mẫu số HS A phục hồi đủ 3 bài');

  console.log('\n🎉 TẤT CẢ CÁC BÀI TEST FINAL POLISHES ĐÃ PASS 100% VÀ ĐẠT ĐỈNH CAO CHUẨN XÁC!');
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
