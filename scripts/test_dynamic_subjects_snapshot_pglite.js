import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ --liftoff-only kết hợp các cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên Windows
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
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

async function setupSchema(db) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT current_setting('request.jwt.claim.sub', true)::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT,
      role TEXT DEFAULT 'student',
      avatar_url TEXT,
      grade_level INT,
      total_stars INT DEFAULT 0,
      total_coins INT DEFAULT 0,
      student_code TEXT
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      grade_level INT NOT NULL,
      teacher_id UUID REFERENCES public.profiles(id)
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS public.ranking_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      created_by UUID REFERENCES public.profiles(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      closed_by UUID REFERENCES public.profiles(id)
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID NOT NULL REFERENCES public.ranking_periods(id),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      delta_stars INT NOT NULL DEFAULT 0,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID NOT NULL REFERENCES public.ranking_periods(id),
      class_id UUID NOT NULL REFERENCES public.classes(id),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      subject TEXT NOT NULL DEFAULT 'ALL',
      game_stars INTEGER DEFAULT 0,
      game_rank INTEGER DEFAULT 0,
      game_completed_count INTEGER DEFAULT 0,
      academic_score_pct NUMERIC(5,1) DEFAULT 0.0,
      academic_rank INTEGER DEFAULT 0,
      academic_completed_count INTEGER DEFAULT 0,
      academic_assigned_count INTEGER DEFAULT 0,
      completion_rate_pct NUMERIC(5,1) DEFAULT 0.0,
      avg_score_pct NUMERIC(5,1) DEFAULT 0.0,
      total_earned_score NUMERIC(7,1) DEFAULT 0.0,
      class_max_score NUMERIC(7,1) DEFAULT 0.0,
      snapshot_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_period_student_subject_result UNIQUE(period_id, student_id, subject)
    );

    CREATE TABLE IF NOT EXISTS public.student_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      game_id UUID,
      assignment_id UUID,
      stars_earned INT DEFAULT 0,
      status TEXT DEFAULT 'completed',
      completed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.student_score_baselines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      class_id UUID NOT NULL REFERENCES public.classes(id),
      scope TEXT NOT NULL CHECK (scope IN ('game', 'academic', 'both')),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_until TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercises (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      grade_level INT NOT NULL DEFAULT 1,
      subject TEXT DEFAULT 'Toán',
      exercise_type TEXT NOT NULL DEFAULT 'mixed',
      status TEXT NOT NULL DEFAULT 'published',
      reward_stars INT DEFAULT 10,
      teacher_id UUID REFERENCES public.profiles(id),
      class_id UUID REFERENCES public.classes(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id),
      question_number INT NOT NULL DEFAULT 1,
      question_type TEXT NOT NULL DEFAULT 'single_choice',
      prompt TEXT NOT NULL,
      points NUMERIC(5,1) NOT NULL DEFAULT 1.0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id),
      class_id UUID NOT NULL REFERENCES public.classes(id),
      assigned_by UUID REFERENCES public.profiles(id),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      due_date TIMESTAMPTZ,
      counts_toward_ranking BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(exercise_id, class_id)
    );

    CREATE TABLE IF NOT EXISTS public.academic_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      status TEXT NOT NULL DEFAULT 'graded',
      objective_score NUMERIC(5,1) DEFAULT 0.0,
      manual_score NUMERIC(5,1) DEFAULT 0.0,
      total_score NUMERIC(5,1) DEFAULT 0.0,
      max_score NUMERIC(5,1) NOT NULL DEFAULT 10.0,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION app_private.can_manage_class(p_class_id UUID) RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = auth.uid()
      ) OR EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
      );
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION app_private.can_read_class(p_class_id UUID) RETURNS BOOLEAN AS $$
      SELECT app_private.can_manage_class(p_class_id) OR EXISTS (
        SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = auth.uid()
      );
    $$ LANGUAGE sql STABLE;
  `);

  // RPC get_game_period_leaderboard từ ADD_SCORE_RANKING_BASELINE.sql
  const baselineSqlPath = path.join(__dirname, '..', 'ADD_SCORE_RANKING_BASELINE.sql');
  const baselineSql = await fs.readFile(baselineSqlPath, 'utf8');

  const gameStartIdx = baselineSql.indexOf('CREATE OR REPLACE FUNCTION public.get_game_period_leaderboard(');
  const gameEndIdx = baselineSql.indexOf('REVOKE ALL ON FUNCTION public.get_game_period_leaderboard');
  const gameSql = baselineSql.substring(gameStartIdx, gameEndIdx);
  await db.exec(gameSql);

  // Nạp NGUYÊN VẸN file migration ADD_DYNAMIC_SUBJECTS_TO_CLOSE_RANKING_PERIOD.sql
  // Chứa close_ranking_period VÀ get_academic_period_leaderboard chuẩn hóa không monkey-patch
  const newMigrationPath = path.join(__dirname, '..', 'ADD_DYNAMIC_SUBJECTS_TO_CLOSE_RANKING_PERIOD.sql');
  const newMigrationSql = await fs.readFile(newMigrationPath, 'utf8');
  await db.exec(newMigrationSql);
}

async function run() {
  console.log('=== TEST SUITE: DYNAMIC SUBJECT SNAPSHOT IN CLOSE_RANKING_PERIOD ===\n');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

  await setupSchema(db);
  console.log('✅ Đã nạp thành công Schema, get_game_period_leaderboard và migration ADD_DYNAMIC_SUBJECTS_TO_CLOSE_RANKING_PERIOD.sql nguyên vẹn (Không monkey-patch).\n');

  // --- SEED DỮ LIỆU CƠ BẢN CHO KỲ CHÍNH (PERIOD 1) ---
  const teacherId = '11111111-1111-1111-1111-111111111111';
  const classId = '22222222-2222-2222-2222-222222222222';
  const st1Id = '33333333-3333-3333-3333-333333333331';
  const st2Id = '33333333-3333-3333-3333-333333333332';
  const st3Id = '33333333-3333-3333-3333-333333333333';
  const st4Id = '33333333-3333-3333-3333-333333333334';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, role, student_code) VALUES
      ('${teacherId}', 'Cô Nguyễn Thị Hoa', 'teacher', 'GV01'),
      ('${st1Id}', 'Nguyễn Văn Nam', 'student', 'HS01'),
      ('${st2Id}', 'Lê Thị Mai', 'student', 'HS02'),
      ('${st3Id}', 'Trần Đức Anh', 'student', 'HS03'),
      ('${st4Id}', 'Phạm Hoàng Yến', 'student', 'HS04');

    INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
      ('${classId}', 'Lớp 3A', 3, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${classId}', '${st1Id}'),
      ('${classId}', '${st2Id}'),
      ('${classId}', '${st3Id}'),
      ('${classId}', '${st4Id}');
  `);

  // Thiết lập auth caller là Teacher
  await db.exec(`SET request.jwt.claim.sub = '${teacherId}';`);

  const periodId = '44444444-4444-4444-4444-444444444444';
  const startAt = '2026-09-01T00:00:00Z';
  const endAt = '2026-09-30T23:59:59Z';

  await db.exec(`
    INSERT INTO public.ranking_periods (id, class_id, name, status, start_at, end_at, created_by)
    VALUES ('${periodId}', '${classId}', 'Kỳ Tháng 9/2026', 'ACTIVE', '${startAt}', '${endAt}', '${teacherId}');
  `);

  // IDs bài tập
  const exMathId = '55555555-5555-5555-5555-000000000001'; // 'Toán'
  const exTvId = '55555555-5555-5555-5555-000000000002'; // 'Tiếng Việt'
  const exEngId = '55555555-5555-5555-5555-000000000003'; // 'Tiếng Anh'
  const exInfoId = '55555555-5555-5555-5555-000000000004'; // 'Tin học'
  const exBeforeAssignedId = '55555555-5555-5555-5555-000000000005'; // F: assigned trước start
  const exExactStartAssignedId = '55555555-5555-5555-5555-000000000006'; // G: assigned đúng start
  const exExactEndAssignedId = '55555555-5555-5555-5555-000000000007'; // H: assigned đúng end
  const exLateSubmitId = '55555555-5555-5555-5555-000000000008'; // L: giao trong kỳ nộp sau end
  const exEssayPendingId = '55555555-5555-5555-5555-000000000009'; // O: essay chưa graded
  const exBlankSubjectId = '55555555-5555-5555-5555-000000000010'; // T: subject rỗng
  const exNullSubjectId = '55555555-5555-5555-5555-000000000011'; // T: subject NULL
  const exUnassignedSubjId = '55555555-5555-5555-5555-000000000012'; // Môn Âm nhạc không giao trong kỳ
  
  // U: Normalization test IDs
  const exMathSpaceId = '55555555-5555-5555-5555-000000000013'; // ' toán '
  const exMathUpperId = '55555555-5555-5555-5555-000000000014'; // 'TOÁN'
  const exInfoUpperId = '55555555-5555-5555-5555-000000000015'; // 'TIN HỌC'

  await db.exec(`
    INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
      ('${exMathId}', 'Phép Nhân Lớp 3', 'Toán', 'published', '${classId}', '${teacherId}'),
      ('${exTvId}', 'Tập Đọc Tuần 2', 'Tiếng Việt', 'published', '${classId}', '${teacherId}'),
      ('${exEngId}', 'Unit 1: Hello', 'Tiếng Anh', 'published', '${classId}', '${teacherId}'),
      ('${exInfoId}', 'Làm quen máy tính', 'Tin học', 'published', '${classId}', '${teacherId}'),
      ('${exBeforeAssignedId}', 'Bài tập ôn hè', 'Toán', 'published', '${classId}', '${teacherId}'),
      ('${exExactStartAssignedId}', 'Khởi động năm học', 'Toán', 'published', '${classId}', '${teacherId}'),
      ('${exExactEndAssignedId}', 'Bài tập tháng sau', 'Toán', 'published', '${classId}', '${teacherId}'),
      ('${exLateSubmitId}', 'Bài tập tuần cuối', 'Tin học', 'published', '${classId}', '${teacherId}'),
      ('${exEssayPendingId}', 'Tập làm văn tả con vật', 'Tiếng Việt', 'published', '${classId}', '${teacherId}'),
      ('${exBlankSubjectId}', 'Bài không có môn', '   ', 'published', '${classId}', '${teacherId}'),
      ('${exNullSubjectId}', 'Bài môn NULL', NULL, 'published', '${classId}', '${teacherId}'),
      ('${exUnassignedSubjId}', 'Hát Quốc ca', 'Âm nhạc', 'published', '${classId}', '${teacherId}'),
      ('${exMathSpaceId}', 'Toán có space', ' toán ', 'published', '${classId}', '${teacherId}'),
      ('${exMathUpperId}', 'TOÁN IN HOA', 'TOÁN', 'published', '${classId}', '${teacherId}'),
      ('${exInfoUpperId}', 'TIN HỌC IN HOA', 'TIN HỌC', 'published', '${classId}', '${teacherId}');

    -- Questions
    INSERT INTO public.academic_exercise_questions (exercise_id, question_number, question_type, prompt, points) VALUES
      ('${exMathId}', 1, 'single_choice', '2x3=?', 10.0),
      ('${exTvId}', 1, 'single_choice', 'Từ nào đúng chính tả?', 10.0),
      ('${exEngId}', 1, 'single_choice', 'Hello = ?', 10.0),
      ('${exInfoId}', 1, 'single_choice', 'CPU là gì?', 10.0),
      ('${exBeforeAssignedId}', 1, 'single_choice', '1+1=?', 10.0),
      ('${exExactStartAssignedId}', 1, 'single_choice', '3+3=?', 10.0),
      ('${exExactEndAssignedId}', 1, 'single_choice', '4+4=?', 10.0),
      ('${exLateSubmitId}', 1, 'single_choice', 'RAM là gì?', 10.0),
      ('${exEssayPendingId}', 1, 'essay', 'Hãy viết bài văn ngắn tả con mèo', 10.0),
      ('${exBlankSubjectId}', 1, 'single_choice', 'Câu hỏi rác', 10.0),
      ('${exNullSubjectId}', 1, 'single_choice', 'Câu hỏi NULL', 10.0),
      ('${exMathSpaceId}', 1, 'single_choice', '5x5=?', 10.0),
      ('${exMathUpperId}', 1, 'single_choice', '6x6=?', 10.0),
      ('${exInfoUpperId}', 1, 'single_choice', 'GPU là gì?', 10.0);

    -- Assignments
    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_at, counts_toward_ranking) VALUES
      ('${exMathId}', '${classId}', '2026-09-05T08:00:00Z', true),
      ('${exTvId}', '${classId}', '2026-09-10T08:00:00Z', true),
      ('${exEngId}', '${classId}', '2026-09-15T08:00:00Z', true),
      ('${exInfoId}', '${classId}', '2026-09-20T08:00:00Z', true),
      ('${exBeforeAssignedId}', '${classId}', '2026-08-31T23:59:59Z', true),
      ('${exExactStartAssignedId}', '${classId}', '2026-09-01T00:00:00Z', true),
      ('${exExactEndAssignedId}', '${classId}', '2026-09-30T23:59:59Z', true),
      ('${exLateSubmitId}', '${classId}', '2026-09-25T08:00:00Z', true),
      ('${exEssayPendingId}', '${classId}', '2026-09-12T08:00:00Z', true),
      ('${exBlankSubjectId}', '${classId}', '2026-09-14T08:00:00Z', true),
      ('${exNullSubjectId}', '${classId}', '2026-09-14T08:00:00Z', true),
      ('${exMathSpaceId}', '${classId}', '2026-09-07T08:00:00Z', true),
      ('${exMathUpperId}', '${classId}', '2026-09-08T08:00:00Z', true),
      ('${exInfoUpperId}', '${classId}', '2026-09-22T08:00:00Z', true);
  `);

  // Submissions:
  await db.exec(`
    -- Baseline cho st3: scope = both từ 2026-09-18
    INSERT INTO public.student_score_baselines (student_id, class_id, scope, effective_from)
    VALUES ('${st3Id}', '${classId}', 'both', '2026-09-18T00:00:00Z');

    -- Baseline bị thu hồi cho st4
    INSERT INTO public.student_score_baselines (student_id, class_id, scope, effective_from, revoked_at)
    VALUES ('${st4Id}', '${classId}', 'academic', '2026-09-18T00:00:00Z', '2026-09-19T00:00:00Z');

    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, manual_score, total_score, max_score, submitted_at) VALUES
      -- st1
      ('${exMathId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-06T09:00:00Z'),
      ('${exTvId}', '${st1Id}', 'graded', 8.5, 0.0, 8.5, 10.0, '2026-09-11T09:00:00Z'),
      ('${exEngId}', '${st1Id}', 'submitted', 10.0, 0.0, 10.0, 10.0, '2026-09-16T09:00:00Z'),
      ('${exInfoId}', '${st1Id}', 'graded', 9.0, 0.0, 9.0, 10.0, '2026-09-21T09:00:00Z'),
      ('${exExactStartAssignedId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-01T00:00:00Z'),
      ('${exLateSubmitId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-10-01T01:00:00Z'),
      ('${exEssayPendingId}', '${st1Id}', 'submitted', 0.0, 0.0, 0.0, 10.0, '2026-09-13T09:00:00Z'),
      ('${exMathSpaceId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-08T09:00:00Z'),
      ('${exMathUpperId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-09T09:00:00Z'),
      ('${exInfoUpperId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-23T09:00:00Z'),

      -- st2
      ('${exMathId}', '${st2Id}', 'graded', 8.0, 0.0, 8.0, 10.0, '2026-09-06T10:00:00Z'),
      ('${exEngId}', '${st2Id}', 'graded', 7.0, 0.0, 7.0, 10.0, '2026-09-16T10:00:00Z'),
      ('${exInfoId}', '${st2Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-21T10:00:00Z'),
      ('${exExactStartAssignedId}', '${st2Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-08-31T23:59:59Z'),
      ('${exTvId}', '${st2Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-30T23:59:59Z'),

      -- st3 (baseline 2026-09-18)
      ('${exMathId}', '${st3Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-06T09:00:00Z'),
      ('${exInfoId}', '${st3Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-21T09:00:00Z'),

      -- st4 (baseline revoked)
      ('${exMathId}', '${st4Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-06T09:00:00Z');

    -- Game progress
    INSERT INTO public.student_progress (student_id, stars_earned, status, completed_at) VALUES
      ('${st1Id}', 50, 'completed', '2026-09-08T10:00:00Z'),
      ('${st2Id}', 75, 'completed', '2026-09-08T11:00:00Z'),
      ('${st3Id}', 50, 'completed', '2026-09-10T10:00:00Z'), -- trước baseline -> BỊ LOẠI
      ('${st3Id}', 30, 'completed', '2026-09-20T10:00:00Z'); -- sau baseline -> ĐƯỢC TÍNH 30 SAO

    INSERT INTO public.ranking_period_adjustments (period_id, student_id, delta_stars) VALUES
      ('${periodId}', '${st1Id}', 10);
  `);

  const tests = [];

  const matchLeaderboard = (activeList, closedList) => {
    if (!activeList || !closedList) return false;
    if (activeList.length !== closedList.length) return false;
    return activeList.every((act, idx) => {
      const cls = closedList[idx];
      return (
        act.student_id === cls.student_id &&
        Number(act.academic_score_pct) === Number(cls.academic_score_pct) &&
        Number(act.rank) === Number(cls.rank) &&
        Number(act.completed_count) === Number(cls.completed_count) &&
        Number(act.total_valid_count) === Number(cls.total_valid_count) &&
        Number(act.completion_rate_pct) === Number(cls.completion_rate_pct) &&
        Number(act.total_earned_score) === Number(cls.total_earned_score)
      );
    });
  };

  // =========================================================================
  // BƯỚC 1: LẤY DỮ LIỆU ACTIVE TRƯỚC CLOSE (BAO GỒM CÁC BIẾN THỂ CASE/WHITESPACE)
  // =========================================================================
  const activeAll = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'ALL') AS res;`)).rows[0].res;
  const activeMath = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Toán') AS res;`)).rows[0].res;
  const activeMathSpace = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', ' toán ') AS res;`)).rows[0].res;
  const activeMathUpper = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'TOÁN') AS res;`)).rows[0].res;

  const activeTv = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Tiếng Việt') AS res;`)).rows[0].res;
  const activeEng = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Tiếng Anh') AS res;`)).rows[0].res;
  const activeInfo = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Tin học') AS res;`)).rows[0].res;
  const activeGame = (await db.query(`SELECT public.get_game_period_leaderboard('${periodId}') AS res;`)).rows[0].res;

  // =========================================================================
  // BƯỚC 2: THỰC HIỆN CLOSE_RANKING_PERIOD
  // =========================================================================
  const closeRes = (await db.query(`SELECT public.close_ranking_period('${periodId}') AS res;`)).rows[0].res;

  // =========================================================================
  // BƯỚC 3: LẤY DỮ LIỆU CLOSED SAU CLOSE (BAO GỒM CÁC BIẾN THỂ CASE/WHITESPACE)
  // =========================================================================
  const closedAll = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'ALL') AS res;`)).rows[0].res;
  const closedMath = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Toán') AS res;`)).rows[0].res;
  const closedMathSpace = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', ' toán ') AS res;`)).rows[0].res;
  const closedMathUpper = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'TOÁN') AS res;`)).rows[0].res;

  const closedTv = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Tiếng Việt') AS res;`)).rows[0].res;
  const closedEng = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Tiếng Anh') AS res;`)).rows[0].res;
  const closedInfo = (await db.query(`SELECT public.get_academic_period_leaderboard('${periodId}', 'Tin học') AS res;`)).rows[0].res;
  const closedGame = (await db.query(`SELECT public.get_game_period_leaderboard('${periodId}') AS res;`)).rows[0].res;

  const snapSubjects = (await db.query(`
    SELECT DISTINCT subject FROM public.ranking_period_results WHERE period_id = '${periodId}' ORDER BY subject ASC;
  `)).rows.map(r => r.subject);

  // =========================================================================
  // KIỂM TRA ĐẦY ĐỦ CÁC MỤC TỪ A ĐẾN W
  // =========================================================================

  // A. Toán + Tiếng Việt
  tests.push({
    code: 'A',
    name: 'Toán & Tiếng Việt có mặt trong snapshot results',
    pass: snapSubjects.includes('Toán') && snapSubjects.includes('Tiếng Việt')
  });

  // B. Tiếng Anh
  tests.push({
    code: 'B',
    name: 'Môn dynamic Tiếng Anh có mặt trong snapshot results',
    pass: snapSubjects.includes('Tiếng Anh') && closedEng && closedEng.length === 4
  });

  // C. Tin học
  tests.push({
    code: 'C',
    name: 'Môn dynamic Tin học có mặt trong snapshot results',
    pass: snapSubjects.includes('Tin học') && closedInfo && closedInfo.length === 4
  });

  // D. ALL
  tests.push({
    code: 'D',
    name: 'Subject ALL có mặt trong snapshot và tổng hợp đầy đủ',
    pass: snapSubjects.includes('ALL') && closedAll && closedAll.length === 4
  });

  // E. ACTIVE -> CLOSE -> CLOSED equality
  tests.push({
    code: 'E1',
    name: 'ACTIVE vs CLOSED equality: Môn Toán khớp 100% từng học sinh',
    pass: matchLeaderboard(activeMath.leaderboard, closedMath)
  });

  tests.push({
    code: 'E2',
    name: 'ACTIVE vs CLOSED equality: Môn Tiếng Việt khớp 100% từng học sinh',
    pass: matchLeaderboard(activeTv.leaderboard, closedTv)
  });

  tests.push({
    code: 'E3',
    name: 'ACTIVE vs CLOSED equality: Môn Tiếng Anh khớp 100% từng học sinh',
    pass: matchLeaderboard(activeEng.leaderboard, closedEng)
  });

  tests.push({
    code: 'E4',
    name: 'ACTIVE vs CLOSED equality: Môn Tin học khớp 100% từng học sinh',
    pass: matchLeaderboard(activeInfo.leaderboard, closedInfo)
  });

  tests.push({
    code: 'E5',
    name: 'ACTIVE vs CLOSED equality: Tổng hợp ALL khớp 100% từng học sinh',
    pass: matchLeaderboard(activeAll.leaderboard, closedAll)
  });

  // F. bài assigned trước start -> không vào kỳ
  tests.push({
    code: 'F',
    name: 'Bài assigned trước start (exBeforeAssignedId) không tính vào tổng bài môn Toán (tổng valid = 4 bài)',
    pass: activeMath.total_valid_exercises === 4 && closedMath[0].total_valid_count === 4
  });

  // G. assigned đúng start -> vào kỳ
  tests.push({
    code: 'G',
    name: 'Bài assigned đúng start (exExactStartAssignedId) được tính vào mẫu số của kỳ',
    pass: closedMath.find(s => s.student_id === st1Id)?.completed_count >= 2
  });

  // H. assigned đúng end -> không vào kỳ
  tests.push({
    code: 'H',
    name: 'Bài assigned đúng end (exExactEndAssignedId) không tính vào kỳ',
    pass: activeMath.total_valid_exercises === 4
  });

  // I. submitted trước start -> không tính
  tests.push({
    code: 'I',
    name: 'Submitted trước start (st2 nộp bài exExactStartAssignedId trước start) -> không được tính điểm',
    pass: closedMath.find(s => s.student_id === st2Id)?.total_earned_score === 8.0
  });

  // J. submitted đúng start -> tính
  tests.push({
    code: 'J',
    name: 'Submitted đúng start (st1 nộp bài exExactStartAssignedId đúng start) -> được tính điểm đầy đủ',
    pass: closedMath.find(s => s.student_id === st1Id)?.total_earned_score === 40.0
  });

  // K. submitted đúng end -> không tính
  tests.push({
    code: 'K',
    name: 'Submitted đúng end (st2 nộp exTvId lúc 2026-09-30T23:59:59Z) -> không tính vào kỳ nửa mở [start, end)',
    pass: closedTv.find(s => s.student_id === st2Id)?.total_earned_score === 0.0
  });

  // L. bài giao trong kỳ nhưng nộp sau end -> không tính
  tests.push({
    code: 'L',
    name: 'Bài giao trong kỳ nhưng nộp sau end (st1 nộp exLateSubmitId sau end) -> không tính điểm',
    pass: closedInfo.find(s => s.student_id === st1Id)?.total_earned_score === 19.0
  });

  // M. graded decimal score
  tests.push({
    code: 'M',
    name: 'Graded decimal score: st1 đạt điểm thập phân 8.5đ -> total_earned_score = 8.5, avg_score = 85.0%, academic_score_pct = 42.5% (trên tổng 20đ)',
    pass: closedTv.find(s => s.student_id === st1Id)?.total_earned_score === 8.5 &&
          closedTv.find(s => s.student_id === st1Id)?.academic_score_pct === 42.5
  });

  // N. objective submitted hợp lệ
  tests.push({
    code: 'N',
    name: 'Objective submitted hợp lệ (st1 nộp trắc nghiệm Tiếng Anh status submitted) -> được tính 100.0%',
    pass: closedEng.find(s => s.student_id === st1Id)?.academic_score_pct === 100.0
  });

  // O. essay submitted chưa graded -> không tính
  tests.push({
    code: 'O',
    name: 'Essay submitted chưa graded (exEssayPendingId) -> không tính điểm và không tính vào completed_count',
    pass: closedTv.find(s => s.student_id === st1Id)?.completed_count === 1
  });

  // P. baseline effective_from
  tests.push({
    code: 'P',
    name: 'Baseline effective_from (st3 có baseline từ 18/9 -> bài nộp trước bị bỏ qua, bài nộp sau được tính)',
    pass: closedMath.find(s => s.student_id === st3Id)?.total_earned_score === 0.0 &&
          closedMath.find(s => s.student_id === st3Id)?.total_valid_count === 0 &&
          closedInfo.find(s => s.student_id === st3Id)?.total_earned_score === 10.0
  });

  // Q. revoked baseline
  tests.push({
    code: 'Q',
    name: 'Revoked baseline (st4 có baseline bị thu hồi -> tính điểm bình thường từ đầu kỳ)',
    pass: closedMath.find(s => s.student_id === st4Id)?.total_earned_score === 10.0 &&
          closedMath.find(s => s.student_id === st4Id)?.total_valid_count === 4
  });

  // R. game snapshot regression
  const gameSnapshot = (await db.query(`
    SELECT student_id, game_stars, game_rank FROM public.ranking_period_results WHERE period_id = '${periodId}' AND subject = 'ALL' ORDER BY game_rank ASC;
  `)).rows;

  tests.push({
    code: 'R',
    name: 'Game snapshot regression: st2 có 75 sao (hạng 1), st1 có 50+10=60 sao (hạng 2)',
    pass: gameSnapshot.find(g => g.student_id === st2Id)?.game_stars === 75 &&
          gameSnapshot.find(g => g.student_id === st1Id)?.game_stars === 60
  });

  // S. duplicate close / conflict behavior
  const dupCloseRes = (await db.query(`SELECT public.close_ranking_period('${periodId}') AS res;`)).rows[0].res;
  await db.exec(`UPDATE public.ranking_periods SET status = 'ACTIVE' WHERE id = '${periodId}';`);
  const recloseRes = (await db.query(`SELECT public.close_ranking_period('${periodId}') AS res;`)).rows[0].res;

  tests.push({
    code: 'S',
    name: 'Duplicate close contract: Kỳ đã CLOSED trả về INVALID_STATUS; Khi mở lại và close lại thì ON CONFLICT DO UPDATE thành công',
    pass: dupCloseRes.status === 'INVALID_STATUS' && recloseRes.status === 'CLOSED'
  });

  // T. subject NULL/rỗng không tạo snapshot
  const expectedSubjects = ['ALL', 'Tin học', 'Tiếng Anh', 'Tiếng Việt', 'Toán'];
  const hasAllExpected = expectedSubjects.every(s => snapSubjects.includes(s));
  const hasNoExtra = snapSubjects.length === expectedSubjects.length;

  tests.push({
    code: 'T',
    name: 'Subject NULL/rỗng: Không sinh subject rác (chỉ đúng 5 subjects thực tế: ALL, Tin học, Tiếng Anh, Tiếng Việt, Toán)',
    pass: hasAllExpected &&
          hasNoExtra &&
          !snapSubjects.includes('') &&
          !snapSubjects.includes('   ') &&
          !snapSubjects.includes(null)
  });

  // U1. ACTIVE Subject Normalization (Case/Whitespace variants match same result)
  tests.push({
    code: 'U1',
    name: 'ACTIVE Subject Normalization: p_subject = "Toán", " toán ", "TOÁN" trả về kết quả 100% như nhau',
    pass: matchLeaderboard(activeMath.leaderboard, activeMathSpace.leaderboard) &&
          matchLeaderboard(activeMath.leaderboard, activeMathUpper.leaderboard) &&
          activeMath.total_valid_exercises === 4
  });

  // U2. CLOSED Subject Normalization (Case/Whitespace variants match same snapshot)
  tests.push({
    code: 'U2',
    name: 'CLOSED Subject Normalization: p_subject = "Toán", " toán ", "TOÁN" sau khi đóng kỳ đọc cùng 1 snapshot kết quả',
    pass: matchLeaderboard(closedMath, closedMathSpace) &&
          matchLeaderboard(closedMath, closedMathUpper) &&
          closedMath.length === 4
  });

  // U3. ACTIVE == CLOSED cho dữ liệu subject hỗn hợp
  tests.push({
    code: 'U3',
    name: 'ACTIVE == CLOSED Equality: Bảng xếp hạng ACTIVE và CLOSED snapshot khớp nhau 100% cho dữ liệu môn có "Toán", " toán ", "TOÁN"',
    pass: matchLeaderboard(activeMath.leaderboard, closedMath) &&
          matchLeaderboard(activeMathSpace.leaderboard, closedMathSpace) &&
          matchLeaderboard(activeMathUpper.leaderboard, closedMathUpper)
  });

  // U4. Snapshot Deduplication trong Database
  const mathSnapCount = (await db.query(`
    SELECT COUNT(*)::int AS cnt FROM public.ranking_period_results WHERE period_id = '${periodId}' AND LOWER(TRIM(subject)) = 'toán';
  `)).rows[0].cnt;

  const infoSnapCount = (await db.query(`
    SELECT COUNT(*)::int AS cnt FROM public.ranking_period_results WHERE period_id = '${periodId}' AND LOWER(TRIM(subject)) = 'tin học';
  `)).rows[0].cnt;

  tests.push({
    code: 'U4',
    name: 'Snapshot Deduplication: DB chỉ lưu duy nhất 1 subject logic cho Toán (4 học sinh) và 1 cho Tin học (4 học sinh)',
    pass: mathSnapCount === 4 &&
          infoSnapCount === 4 &&
          snapSubjects.filter(s => s.toLowerCase() === 'toán').length === 1 &&
          snapSubjects.filter(s => s.toLowerCase() === 'tin học').length === 1
  });

  // V. Game ACTIVE -> CLOSED equality với baseline
  const matchGameLeaderboard = (actList, clsList) => {
    if (!actList || !clsList || actList.length !== clsList.length) return false;
    return actList.every((act, idx) => {
      const cls = clsList[idx];
      return (
        act.student_id === cls.student_id &&
        Number(act.period_stars) === Number(cls.period_stars) &&
        Number(act.rank) === Number(cls.rank) &&
        Number(act.completed_count) === Number(cls.completed_count)
      );
    });
  };

  tests.push({
    code: 'V',
    name: 'Game ACTIVE vs CLOSED baseline equality: st3 có baseline 18/9 -> progress 50 sao trước bị loại, 30 sao sau được tính, ACTIVE == CLOSED 100%',
    pass: matchGameLeaderboard(activeGame, closedGame) &&
          closedGame.find(g => g.student_id === st3Id)?.period_stars === 30 &&
          closedGame.find(g => g.student_id === st3Id)?.rank === 3
  });

  // W. Stale snapshot cleanup on Re-close
  const exHistoryId = '55555555-5555-5555-5555-000000000099';
  await db.exec(`
    UPDATE public.ranking_periods SET status = 'ACTIVE' WHERE id = '${periodId}';
    UPDATE public.academic_exercise_assignments SET counts_toward_ranking = FALSE WHERE exercise_id = '${exEngId}';

    INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id)
    VALUES ('${exHistoryId}', 'Lịch sử lớp 3', 'Lịch sử', 'published', '${classId}', '${teacherId}');

    INSERT INTO public.academic_exercise_questions (exercise_id, question_number, question_type, prompt, points)
    VALUES ('${exHistoryId}', 1, 'single_choice', 'Chiến thắng Bạch Đằng năm nào?', 10.0);

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_at, counts_toward_ranking)
    VALUES ('${exHistoryId}', '${classId}', '2026-09-24T08:00:00Z', TRUE);

    INSERT INTO public.academic_submissions (exercise_id, student_id, status, objective_score, manual_score, total_score, max_score, submitted_at)
    VALUES ('${exHistoryId}', '${st1Id}', 'graded', 10.0, 0.0, 10.0, 10.0, '2026-09-25T09:00:00Z');
  `);

  await db.query(`SELECT public.close_ranking_period('${periodId}');`);

  const reclosedSnapSubjects = (await db.query(`
    SELECT DISTINCT subject FROM public.ranking_period_results WHERE period_id = '${periodId}' ORDER BY subject ASC;
  `)).rows.map(r => r.subject);

  tests.push({
    code: 'W',
    name: 'Stale Subject Cleanup: Re-close kỳ sau khi gỡ Tiếng Anh và thêm Lịch sử -> Snapshot xóa sạch Tiếng Anh cũ và nạp Lịch sử mới',
    pass: !reclosedSnapSubjects.includes('Tiếng Anh') &&
          reclosedSnapSubjects.includes('Lịch sử') &&
          reclosedSnapSubjects.includes('ALL') &&
          reclosedSnapSubjects.includes('Toán')
  });

  // =========================================================================
  // TỔNG KẾT VÀ BÁO CÁO
  // =========================================================================
  let passCount = 0;
  tests.forEach((t) => {
    if (t.pass) {
      console.log(`✅ [PASS] [${t.code}] ${t.name}`);
      passCount++;
    } else {
      console.error(`❌ [FAIL] [${t.code}] ${t.name}`);
    }
  });

  console.log(`\n========================================`);
  console.log(`KẾT QUẢ TEST SUITE DYNAMIC SUBJECTS: ${passCount}/${tests.length} PASS (${Math.round(passCount / tests.length * 100)}%)`);
  console.log(`========================================\n`);

  if (passCount !== tests.length) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
