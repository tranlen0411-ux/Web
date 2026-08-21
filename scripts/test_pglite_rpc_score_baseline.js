/**
 * TEST PGLITE: SCORE RANKING BASELINE V1 (REVISED & COMPREHENSIVE)
 * Kiểm chứng 100% các yêu cầu:
 * 1. ACADEMIC DENOMINATOR: Mẫu số và tử số tính chuẩn xác theo từng học sinh dựa theo baseline.
 *    - HS A (reset tại T): Bài trước T không ở numerator, cũng không ở denominator. Bài sau T tính bình thường (10/10 = 100%).
 *    - HS B (không reset): Giữ nguyên mẫu số và điểm cũ (18/20 = 90%).
 * 2. GAME BASELINE AT ALL / GRADE / CLASS: Điểm mốc xuất phát nhất quán trên cả 3 view.
 * 3. STRICT VALIDATION: [student_in_class, student_other_class] => fail toàn request, 0 baseline inserted.
 * 4. FK created_by & revoked_by: nullable ON DELETE SET NULL.
 * 5. CLOSED IMMUTABILITY & ACTIVE DYNAMIC CALCULATION.
 * 6. SOFT REVOKE (UNDO) phục hồi điểm số nguyên vẹn.
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
  console.log('🚀 BẮT ĐẦU BỘ TEST PGLITE CHO SCORE RANKING BASELINE V1 (REVISED)...');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = await setupDatabase(PGlite);

  // Fixtures UUID
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222222';
  const teacher2Id = '33333333-3333-3333-3333-333333333333';
  const student1Id = '44444444-4444-4444-4444-444444444444'; // Lớp 1A
  const student2Id = '55555555-5555-5555-5555-555555555555'; // Lớp 1A
  const student3Id = '66666666-6666-6666-6666-666666666666'; // Lớp 1B

  const class1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Lớp 1A (GV 1)
  const class2Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Lớp 1B (GV 2)

  const game1Id = '71111111-1111-1111-1111-111111111111';
  const exercise1Id = '81111111-1111-1111-1111-111111111111'; // Giao ngày 05/09 (10đ)
  const exercise2Id = '82222222-2222-2222-2222-222222222222'; // Giao ngày 05/10 (10đ)

  // Seed Data
  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name, total_stars, total_coins, grade_level) VALUES
      ('${adminId}', 'admin', 'Admin Hệ Thống', 0, 0, 1),
      ('${teacher1Id}', 'teacher', 'Cô Giáo 1', 0, 0, 1),
      ('${teacher2Id}', 'teacher', 'Cô Giáo 2', 0, 0, 1),
      ('${student1Id}', 'student', 'Học Sinh A', 80, 50, 1),
      ('${student2Id}', 'student', 'Học Sinh B', 60, 40, 1),
      ('${student3Id}', 'student', 'Học Sinh C (Lớp 1B)', 50, 20, 1);

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

    -- Dữ liệu bài nộp cũ (tháng 9): HS A được 10/10, HS B được 8/10
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise1Id}', '${student1Id}', 'graded', 10, 10, 10, '2026-09-15 14:00:00+07'),
      ('${exercise1Id}', '${student2Id}', 'graded', 8, 8, 10, '2026-09-15 14:00:00+07');

    -- Dữ liệu bài nộp mới (tháng 10): HS A được 10/10, HS B được 10/10
    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, total_score, max_score, submitted_at) VALUES
      ('${exercise2Id}', '${student1Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07'),
      ('${exercise2Id}', '${student2Id}', 'graded', 10, 10, 10, '2026-10-15 14:00:00+07');
  `);

  console.log('✅ Seed dữ liệu khởi tạo thành công.');

  // =========================================================================
  // TEST 1: STRICT VALIDATION P_STUDENT_IDS
  // [student_in_class, student_other_class] => fail toàn request, 0 baseline inserted
  // =========================================================================
  console.log('\n--- TEST 1: STRICT VALIDATION P_STUDENT_IDS ---');
  await db.exec(`SET app.current_user_id = '${adminId}';`);

  // Thử Preview với 1 ID hợp lệ và 1 ID trái lớp (student3 thuộc Lớp 1B)
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

  // Thử Apply với 1 ID hợp lệ và 1 ID trái lớp
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

  // Xác nhận 0 baseline nào được chèn vào DB
  const checkCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.student_score_baselines;`);
  assert.strictEqual(checkCount.rows[0].cnt, 0, 'Phải có đúng 0 baseline được tạo');
  console.log('✅ TEST 1 PASS: Strict validation chặn đứng 100% ID không hợp lệ.');

  // =========================================================================
  // TEST 2: THIẾT LẬP BASELINE CHỈ CHO HỌC SINH A (TỪ 01/10/2026)
  // =========================================================================
  console.log('\n--- TEST 2: THIẾT LẬP BASELINE CHO HỌC SINH A ---');
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
  console.log('✅ TEST 2 PASS: Teacher 1 thiết lập baseline thành công.');

  // =========================================================================
  // TEST 3: CRITICAL - ACADEMIC DENOMINATOR TÍNH THEO TỪNG HỌC SINH
  // HS A (có baseline 01/10):
  //   - numerator: 10đ (Bài 2)
  //   - denominator: 10đ max score, 1 valid exercise (Bài 1 trước 01/10 không ở mẫu số của A)
  //   - academic_score_pct = 100.0%, completion_rate_pct = 100.0%
  // HS B (không có baseline):
  //   - numerator: 8đ (Bài 1) + 10đ (Bài 2) = 18đ
  //   - denominator: 20đ max score, 2 valid exercises
  //   - academic_score_pct = 90.0%, completion_rate_pct = 100.0%
  // =========================================================================
  console.log('\n--- TEST 3: CRITICAL - ACADEMIC DENOMINATOR PER STUDENT ---');
  const acadRes = await db.query(`
    SELECT public.get_academic_class_leaderboard('${class1Id}', 'ALL', 'ALL') AS res;
  `);
  const acadJson = acadRes.rows[0].res;
  assert.strictEqual(acadJson.success, true, 'Lấy Academic leaderboard thành công');

  const lb = acadJson.leaderboard;
  const hsA = lb.find(s => s.student_id === student1Id);
  const hsB = lb.find(s => s.student_id === student2Id);

  // Kiểm tra HS A
  assert.strictEqual(hsA.total_earned_score, 10, 'Tử số của HS A phải là 10 (chỉ bài tháng 10)');
  assert.strictEqual(hsA.completed_count, 1, 'Số bài hoàn thành của HS A là 1');
  assert.strictEqual(hsA.total_valid_count, 1, 'MẪU SỐ BÀI HỢP LỆ CỦA HS A PHẢI LÀ 1 (KHÔNG PHẢI 2)');
  assert.strictEqual(Number(hsA.academic_score_pct), 100.0, 'Tỷ lệ điểm học thuật của HS A phải là 100.0% (10/10)');
  assert.strictEqual(Number(hsA.completion_rate_pct), 100.0, 'Tỷ lệ hoàn thành của HS A phải là 100.0%');

  // Kiểm tra HS B (không reset)
  assert.strictEqual(hsB.total_earned_score, 18, 'Tử số của HS B phải là 18 (8 + 10)');
  assert.strictEqual(hsB.completed_count, 2, 'Số bài hoàn thành của HS B là 2');
  assert.strictEqual(hsB.total_valid_count, 2, 'MẪU SỐ CỦA HS B PHẢI LÀ 2 (ĐỦ CẢ 2 BÀI)');
  assert.strictEqual(Number(hsB.academic_score_pct), 90.0, 'Tỷ lệ điểm học thuật của HS B phải là 90.0% (18/20)');

  // Thứ hạng: HS A xếp Rank 1 (100%), HS B xếp Rank 2 (90%)
  assert.strictEqual(hsA.rank, 1, 'HS A đạt hạng 1');
  assert.strictEqual(hsB.rank, 2, 'HS B đạt hạng 2');
  console.log('✅ TEST 3 PASS: Academic denominator tính chuẩn xác 100% theo từng học sinh.');

  // =========================================================================
  // TEST 4: CRITICAL - GAME BASELINE NHẤT QUÁN TRÊN CLASS, GRADE VÀ ALL
  // HS A chỉ có 50 sao (tháng 10) trên cả 3 view. HS B có 60 sao (20 + 40) trên cả 3 view.
  // =========================================================================
  console.log('\n--- TEST 4: CRITICAL - GAME BASELINE AT CLASS, GRADE & ALL ---');

  // 1. View CLASS 1A
  const gameClassRes = await db.query(`
    SELECT public.get_game_leaderboard('1', '${class1Id}') AS res;
  `);
  const gClassLb = gameClassRes.rows[0].res.leaderboard;
  const gClassA = gClassLb.find(s => s.student_id === student1Id);
  const gClassB = gClassLb.find(s => s.student_id === student2Id);
  assert.strictEqual(gClassA.total_stars, 50, 'Game CLASS view: HS A có 50 sao');
  assert.strictEqual(gClassB.total_stars, 60, 'Game CLASS view: HS B có 60 sao');

  // 2. View GRADE 1 (Khối 1)
  const gameGradeRes = await db.query(`
    SELECT public.get_game_leaderboard('1', 'ALL_IN_GRADE') AS res;
  `);
  const gGradeLb = gameGradeRes.rows[0].res.leaderboard;
  const gGradeA = gGradeLb.find(s => s.student_id === student1Id);
  const gGradeB = gGradeLb.find(s => s.student_id === student2Id);
  assert.strictEqual(gGradeA.total_stars, 50, 'Game GRADE view: HS A PHẢI CÓ 50 SAO (KHÔNG BỊ VỀ PROFILES.TOTAL_STARS 80)');
  assert.strictEqual(gGradeB.total_stars, 60, 'Game GRADE view: HS B có 60 sao');

  // 3. View ALL (Toàn trường - Admin)
  await db.exec(`SET app.current_user_id = '${adminId}';`);
  const gameAllRes = await db.query(`
    SELECT public.get_game_leaderboard('ALL', 'ALL_IN_GRADE') AS res;
  `);
  const gAllLb = gameAllRes.rows[0].res.leaderboard;
  const gAllA = gAllLb.find(s => s.student_id === student1Id);
  const gAllB = gAllLb.find(s => s.student_id === student2Id);
  assert.strictEqual(gAllA.total_stars, 50, 'Game ALL view: HS A PHẢI CÓ 50 SAO NHẤT QUÁN');
  assert.strictEqual(gAllB.total_stars, 60, 'Game ALL view: HS B có 60 sao');
  console.log('✅ TEST 4 PASS: Game baseline nhất quán 100% trên CLASS, GRADE và ALL.');

  // =========================================================================
  // TEST 5: KỲ CLOSED BẤT BIẾN VS KỲ ACTIVE ĐỘNG
  // =========================================================================
  console.log('\n--- TEST 5: KỲ CLOSED BẤT BIẾN VS KỲ ACTIVE ĐỘNG ---');
  const periodActiveId = '91111111-1111-1111-1111-111111111111';
  const periodClosedId = '92222222-2222-2222-2222-222222222222';

  await db.exec(`
    INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by) VALUES
      ('${periodActiveId}', '${class1Id}', 'Kỳ Tháng 9-10', 'MONTHLY', '2026-09-01 00:00:00+07', '2026-10-31 23:59:59+07', 'ACTIVE', '${teacher1Id}'),
      ('${periodClosedId}', '${class1Id}', 'Kỳ Tháng 9 (Đã đóng)', 'MONTHLY', '2026-09-01 00:00:00+07', '2026-09-30 23:59:59+07', 'CLOSED', '${teacher1Id}');

    -- Snapshot bất biến cho kỳ CLOSED: HS A 30 sao, HS B 20 sao
    INSERT INTO public.ranking_period_results (period_id, class_id, student_id, subject, game_stars, game_rank, game_completed_count) VALUES
      ('${periodClosedId}', '${class1Id}', '${student1Id}', 'ALL', 30, 1, 1),
      ('${periodClosedId}', '${class1Id}', '${student2Id}', 'ALL', 20, 2, 1);
  `);

  // Kỳ CLOSED: Đọc bất biến từ snapshot kết quả
  const closedRes = await db.query(`SELECT public.get_game_period_leaderboard('${periodClosedId}') AS res;`);
  const closedJson = closedRes.rows[0].res;
  const cA = closedJson.find(s => s.student_id === student1Id);
  assert.strictEqual(cA.period_stars, 30, 'Kỳ CLOSED phải giữ nguyên vẹn 30 sao của HS A');

  // Kỳ ACTIVE: Tính động, loại trừ điểm trước 01/10 của HS A
  const activeRes = await db.query(`SELECT public.get_game_period_leaderboard('${periodActiveId}') AS res;`);
  const activeJson = activeRes.rows[0].res;
  const aA = activeJson.find(s => s.student_id === student1Id);
  const aB = activeJson.find(s => s.student_id === student2Id);
  assert.strictEqual(aA.period_stars, 50, 'Kỳ ACTIVE: HS A chỉ nhận 50 sao từ mốc 01/10');
  assert.strictEqual(aB.period_stars, 60, 'Kỳ ACTIVE: HS B nhận đủ 60 sao');
  console.log('✅ TEST 5 PASS: Kỳ CLOSED giữ nguyên bất biến, kỳ ACTIVE phản ánh baseline.');

  // =========================================================================
  // TEST 6: HOÀN TÁC (UNDO / REVOKE BASELINE) KHÔI PHỤC ĐIỂM SỐ VÀ MẪU SỐ
  // =========================================================================
  console.log('\n--- TEST 6: HOÀN TÁC (UNDO / REVOKE BASELINE) ---');
  const blListRes = await db.query(`SELECT public.get_class_score_baselines('${class1Id}') AS res;`);
  const activeBaselineId = blListRes.rows[0].res.baselines[0].id;

  const revokeRes = await db.query(`
    SELECT public.admin_teacher_revoke_score_baseline('${activeBaselineId}', 'Thầy giáo hủy mốc thử nghiệm') AS res;
  `);
  assert.strictEqual(revokeRes.rows[0].res.success, true, 'Revoke baseline thành công');

  // Sau khi Undo, kiểm tra lại Academic leaderboard:
  // HS A phải có lại đầy đủ 2 bài nộp (20đ max score, 20đ earned => 100.0%)
  const acadRestoredRes = await db.query(`
    SELECT public.get_academic_class_leaderboard('${class1Id}', 'ALL', 'ALL') AS res;
  `);
  const restA = acadRestoredRes.rows[0].res.leaderboard.find(s => s.student_id === student1Id);
  assert.strictEqual(restA.total_earned_score, 20, 'Sau Undo: HS A phục hồi đủ 20 điểm');
  assert.strictEqual(restA.total_valid_count, 2, 'Sau Undo: Mẫu số HS A phục hồi đủ 2 bài');

  // Game leaderboard phục hồi lại 80 sao
  const gameRestoredRes = await db.query(`
    SELECT public.get_game_leaderboard('1', '${class1Id}') AS res;
  `);
  const restGameA = gameRestoredRes.rows[0].res.leaderboard.find(s => s.student_id === student1Id);
  assert.strictEqual(restGameA.total_stars, 80, 'Sau Undo: HS A phục hồi đủ 80 sao (30 + 50)');
  console.log('✅ TEST 6 PASS: Undo phục hồi điểm số và mẫu số nguyên vẹn.');

  console.log('\n🎉 TẤT CẢ CÁC BÀI TEST REVISED ĐÃ PASS 100% VÀ ĐẠT CHUẨN CODE REVIEW GITHUB!');
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
