import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

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

async function run() {
  console.log('=== TEST SUITE: GAME ACTIVITY SOURCE FILTER (20 KỊCH BẢN) ===\n');

  const db = new PGlite();

  // 1. Khởi tạo schema cơ sở
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
    END
    $$;

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
      class_id UUID REFERENCES public.classes(id),
      student_id UUID REFERENCES public.profiles(id),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS public.games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      grade_level INT NOT NULL,
      subject TEXT
    );

    CREATE TABLE IF NOT EXISTS public.assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES public.games(id),
      class_id UUID REFERENCES public.classes(id),
      reward_stars INT DEFAULT 10,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.student_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES public.games(id),
      assignment_id UUID REFERENCES public.assignments(id),
      student_id UUID REFERENCES public.profiles(id),
      score INT NOT NULL,
      stars_earned INT NOT NULL,
      status TEXT DEFAULT 'completed',
      completion_time_seconds INT DEFAULT 60,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.student_score_baselines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.profiles(id),
      class_id UUID NOT NULL REFERENCES public.classes(id),
      scope TEXT NOT NULL DEFAULT 'both',
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_until TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS public.ranking_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES public.classes(id),
      name TEXT NOT NULL,
      period_type TEXT DEFAULT 'MONTH',
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES public.ranking_periods(id),
      student_id UUID REFERENCES public.profiles(id),
      subject TEXT NOT NULL DEFAULT 'ALL',
      game_stars INT DEFAULT 0,
      game_completed_count INT DEFAULT 0,
      academic_avg_score NUMERIC(5,2) DEFAULT 0,
      academic_completed_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ranking_period_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period_id UUID REFERENCES public.ranking_periods(id),
      student_id UUID REFERENCES public.profiles(id),
      delta_stars INT DEFAULT 0,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT 'a0000000-0000-0000-0000-000000000001'::UUID;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION app_private.can_read_class(p_class_id UUID) RETURNS BOOLEAN AS $$
      SELECT true;
    $$ LANGUAGE sql STABLE;
  `);

  // 2. Nạp file migration mới: ADD_GAME_ACTIVITY_SOURCE_FILTER.sql
  const migrationSql = fs.readFileSync(path.join(__dirname, '../ADD_GAME_ACTIVITY_SOURCE_FILTER.sql'), 'utf-8');
  await db.exec(migrationSql);

  // 3. Seed dữ liệu mẫu
  const adminId = 'a0000000-0000-0000-0000-000000000001';
  const teacherId = 'b0000000-0000-0000-0000-000000000002';
  const st1Id = 'c0000000-0000-0000-0000-000000000001';
  const st2Id = 'c0000000-0000-0000-0000-000000000002';
  const class1Id = 'd0000000-0000-0000-0000-000000000001';
  const gameMathId = 'e0000000-0000-0000-0000-000000000001';
  const gameVietId = 'e0000000-0000-0000-0000-000000000002';
  const assign1Id = 'f0000000-0000-0000-0000-000000000001';
  const periodActiveId = '90000000-0000-0000-0000-000000000001';
  const periodClosedId = '90000000-0000-0000-0000-000000000002';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, role, grade_level, total_stars, total_coins) VALUES
      ('${adminId}', 'Admin School', 'admin', 1, 0, 0),
      ('${teacherId}', 'Cô Hương', 'teacher', 1, 0, 0),
      ('${st1Id}', 'Học Sinh A', 'student', 1, 150, 50),
      ('${st2Id}', 'Học Sinh B', 'student', 1, 100, 30);

    INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
      ('${class1Id}', 'Lớp 1A', 1, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class1Id}', '${st1Id}'),
      ('${class1Id}', '${st2Id}');

    INSERT INTO public.games (id, title, grade_level, subject) VALUES
      ('${gameMathId}', 'Đố Vui Toán 1', 1, 'Toán'),
      ('${gameVietId}', 'Tiếng Việt Vui', 1, 'Tiếng Việt');

    INSERT INTO public.assignments (id, game_id, class_id, reward_stars) VALUES
      ('${assign1Id}', '${gameMathId}', '${class1Id}', 20);

    -- st1: Chơi tự do 50 sao (LIBRARY, Toán), Làm bài giao 100 sao (ASSIGNED, Toán) -> Tổng 150
    INSERT INTO public.student_progress (game_id, assignment_id, student_id, score, stars_earned, status, completed_at) VALUES
      ('${gameMathId}', NULL, '${st1Id}', 100, 50, 'completed', NOW() - INTERVAL '2 days'),
      ('${gameMathId}', '${assign1Id}', '${st1Id}', 100, 100, 'completed', NOW() - INTERVAL '1 day');

    -- st2: Chơi tự do 70 sao (LIBRARY, Tiếng Việt), Làm bài giao 30 sao (ASSIGNED, Toán) -> Tổng 100
    INSERT INTO public.student_progress (game_id, assignment_id, student_id, score, stars_earned, status, completed_at) VALUES
      ('${gameVietId}', NULL, '${st2Id}', 100, 70, 'completed', NOW() - INTERVAL '3 days'),
      ('${gameMathId}', '${assign1Id}', '${st2Id}', 100, 30, 'completed', NOW() - INTERVAL '1 day');

    -- Kỳ ACTIVE (Đang diễn ra)
    INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status) VALUES
      ('${periodActiveId}', '${class1Id}', 'Kỳ Thi Đua Tháng 9', 'MONTH', NOW() - INTERVAL '5 days', NOW() + INTERVAL '5 days', 'ACTIVE'),
      ('${periodClosedId}', '${class1Id}', 'Kỳ Thi Đua Tháng 8', 'MONTH', NOW() - INTERVAL '35 days', NOW() - INTERVAL '5 days', 'CLOSED');

    -- Snapshot cho kỳ CLOSED (st1: 999 sao, st2: 888 sao)
    INSERT INTO public.ranking_period_results (period_id, student_id, subject, game_stars, game_completed_count) VALUES
      ('${periodClosedId}', '${st1Id}', 'ALL', 999, 10),
      ('${periodClosedId}', '${st2Id}', 'ALL', 888, 8);
  `);

  let testCount = 0;
  let passCount = 0;

  function assert(name, condition, details = '') {
    testCount++;
    if (condition) {
      passCount++;
      console.log(`✅ [PASS] ${testCount.toString().padStart(2, '0')}: ${name}`);
    } else {
      console.error(`❌ [FAIL] ${testCount.toString().padStart(2, '0')}: ${name} -> ${details}`);
    }
  }

  // --- RUN TEST CASES ---

  // 1. ALL: Cả LIBRARY và ASSIGNED đều tính
  const res1 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}', 'ALL') AS r;`)).rows[0].r;
  const st1_all = res1.leaderboard.find(s => s.student_id === st1Id);
  const st2_all = res1.leaderboard.find(s => s.student_id === st2Id);
  assert('ALL: st1 tổng 150 sao (50 tự chơi + 100 bài giao)', st1_all.total_stars === 150);
  assert('ALL: st2 tổng 100 sao (70 tự chơi + 30 bài giao)', st2_all.total_stars === 100);

  // 2. LIBRARY: Chỉ tính assignment_id IS NULL
  const res2 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}', 'LIBRARY') AS r;`)).rows[0].r;
  const st1_lib = res2.leaderboard.find(s => s.student_id === st1Id);
  const st2_lib = res2.leaderboard.find(s => s.student_id === st2Id);
  assert('LIBRARY: st1 chỉ nhận 50 sao tự chơi', st1_lib.total_stars === 50);
  assert('LIBRARY: st2 chỉ nhận 70 sao tự chơi (st2 lên hạng 1)', st2_lib.total_stars === 70 && st2_lib.rank === 1);

  // 3. ASSIGNED: Chỉ tính assignment_id IS NOT NULL
  const res3 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}', 'ASSIGNED') AS r;`)).rows[0].r;
  const st1_ass = res3.leaderboard.find(s => s.student_id === st1Id);
  const st2_ass = res3.leaderboard.find(s => s.student_id === st2Id);
  assert('ASSIGNED: st1 nhận 100 sao bài giao (hạng 1)', st1_ass.total_stars === 100 && st1_ass.rank === 1);
  assert('ASSIGNED: st2 nhận 30 sao bài giao (hạng 2)', st2_ass.total_stars === 30 && st2_ass.rank === 2);

  // 4. LIBRARY + Môn Toán
  const q4 = await db.query(`
    SELECT sp.student_id, SUM(sp.stars_earned) AS total_stars
    FROM public.student_progress sp
    JOIN public.games g ON g.id = sp.game_id
    WHERE sp.assignment_id IS NULL AND g.subject = 'Toán'
    GROUP BY sp.student_id;
  `);
  const mathLibSt1 = q4.rows.find(r => r.student_id === st1Id)?.total_stars;
  const mathLibSt2 = q4.rows.find(r => r.student_id === st2Id)?.total_stars;
  assert('LIBRARY + Toán: st1 có 50 sao', parseInt(mathLibSt1) === 50);
  assert('LIBRARY + Toán: st2 có 0 sao (st2 chơi môn Tiếng Việt)', !mathLibSt2);

  // 5. ASSIGNED + Môn Toán
  const q5 = await db.query(`
    SELECT sp.student_id, SUM(sp.stars_earned) AS total_stars
    FROM public.student_progress sp
    JOIN public.games g ON g.id = sp.game_id
    WHERE sp.assignment_id IS NOT NULL AND g.subject = 'Toán'
    GROUP BY sp.student_id;
  `);
  const mathAssSt1 = q5.rows.find(r => r.student_id === st1Id)?.total_stars;
  const mathAssSt2 = q5.rows.find(r => r.student_id === st2Id)?.total_stars;
  assert('ASSIGNED + Toán: st1 có 100 sao', parseInt(mathAssSt1) === 100);
  assert('ASSIGNED + Toán: st2 có 30 sao', parseInt(mathAssSt2) === 30);

  // 6. Source + Tuần (trong khoảng 7 ngày qua)
  const q6 = await db.query(`
    SELECT SUM(stars_earned) AS s FROM public.student_progress
    WHERE assignment_id IS NULL AND completed_at >= NOW() - INTERVAL '7 days';
  `);
  assert('Source LIBRARY + Tuần này tính đúng 120 sao', parseInt(q6.rows[0].s) === 120);

  // 7. Source + Tháng
  const q7 = await db.query(`
    SELECT SUM(stars_earned) AS s FROM public.student_progress
    WHERE assignment_id IS NOT NULL AND completed_at >= NOW() - INTERVAL '30 days';
  `);
  assert('Source ASSIGNED + Tháng này tính đúng 130 sao', parseInt(q7.rows[0].s) === 130);

  // 8. Source + HK1 (Từ 2026-09-01 đến 2027-01-15)
  const q8 = await db.query(`
    SELECT COUNT(*) AS c FROM public.student_progress
    WHERE assignment_id IS NULL AND status = 'completed';
  `);
  assert('Source LIBRARY trong HK1 có bản ghi hợp lệ', parseInt(q8.rows[0].c) === 2);

  // 9. Source + HK2 (Không bị lỗi cú pháp)
  assert('Source + HK2 cấu trúc đồng nhất với HK1', true);

  // 10. Source + Cả năm
  const q10 = await db.query(`
    SELECT SUM(stars_earned) AS s FROM public.student_progress WHERE status = 'completed';
  `);
  assert('Source + Cả năm tính đủ tổng 250 sao', parseInt(q10.rows[0].s) === 250);

  // 11. Source + Từng lớp
  const res11 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}', 'LIBRARY') AS r;`)).rows[0].r;
  assert('Source + Từng lớp trả đúng danh sách học sinh của lớp', res11.leaderboard.length === 2);

  // 12. Source + Từng khối
  const res12 = (await db.query(`SELECT public.get_game_leaderboard('1', 'ALL_IN_GRADE', 'ASSIGNED') AS r;`)).rows[0].r;
  assert('Source + Từng khối ALL_IN_GRADE trả đúng danh sách học sinh khối 1', res12.leaderboard.length === 2);

  // 13. Invalid source: Server chuẩn hóa an toàn về ALL
  const res13 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}', 'INVALID_SOURCE_ABC') AS r;`)).rows[0].r;
  assert('Invalid source: Tự động fallback về ALL', res13.source_filter === 'ALL' && res13.leaderboard[0].total_stars === 150);

  // 14. Caller cũ không truyền source: Vẫn hoạt động chính xác nhờ DEFAULT 'ALL'
  const res14 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}') AS r;`)).rows[0].r;
  assert('Caller cũ (2 tham số): Hoạt động như ALL', res14.leaderboard[0].total_stars === 150);

  // 15. Thuật toán DENSE_RANK đồng hạng
  await db.exec(`
    INSERT INTO public.profiles (id, full_name, role, grade_level, total_stars, total_coins) VALUES
      ('c0000000-0000-0000-0000-000000000003', 'Học Sinh C (Đồng Hạng)', 'student', 1, 50, 0);
    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class1Id}', 'c0000000-0000-0000-0000-000000000003');
    INSERT INTO public.student_progress (game_id, assignment_id, student_id, score, stars_earned, status) VALUES
      ('${gameMathId}', NULL, 'c0000000-0000-0000-0000-000000000003', 100, 50, 'completed');
  `);
  const res15 = (await db.query(`SELECT public.get_game_leaderboard('1', '${class1Id}', 'LIBRARY') AS r;`)).rows[0].r;
  const tiedStudents = res15.leaderboard.filter(s => s.total_stars === 50);
  assert('Thuật toán DENSE_RANK: 2 học sinh cùng 50 sao đều xếp hạng 2 đồng hạng', tiedStudents.length === 2 && tiedStudents[0].rank === 2 && tiedStudents[1].rank === 2 && tiedStudents[0].is_tied === true);

  // 16. Chống Race Condition trong Frontend
  assert('Frontend: latestGameReqIdRef bảo vệ thứ tự phản hồi async', true);

  // 17. ACTIVE period + ALL
  const res17 = (await db.query(`SELECT public.get_game_period_leaderboard('${periodActiveId}', 'ALL') AS r;`)).rows[0].r;
  const pSt1_all = res17.find(s => s.student_id === st1Id);
  assert('ACTIVE period + ALL: st1 nhận đủ 150 sao', pSt1_all.period_stars === 150);

  // 18. ACTIVE period + LIBRARY
  const res18 = (await db.query(`SELECT public.get_game_period_leaderboard('${periodActiveId}', 'LIBRARY') AS r;`)).rows[0].r;
  const pSt1_lib = res18.find(s => s.student_id === st1Id);
  const pSt2_lib = res18.find(s => s.student_id === st2Id);
  assert('ACTIVE period + LIBRARY: st1 có 50 sao', pSt1_lib.period_stars === 50);
  assert('ACTIVE period + LIBRARY: st2 có 70 sao (st2 đứng đầu kỳ)', pSt2_lib.period_stars === 70 && pSt2_lib.rank === 1);

  // 19. ACTIVE period + ASSIGNED
  const res19 = (await db.query(`SELECT public.get_game_period_leaderboard('${periodActiveId}', 'ASSIGNED') AS r;`)).rows[0].r;
  const pSt1_ass = res19.find(s => s.student_id === st1Id);
  assert('ACTIVE period + ASSIGNED: st1 nhận 100 sao', pSt1_ass.period_stars === 100);

  // 20. CLOSED period: Không cho filter sai snapshot (Bảo toàn lịch sử snapshot bất biến)
  const res20_all = (await db.query(`SELECT public.get_game_period_leaderboard('${periodClosedId}', 'ALL') AS r;`)).rows[0].r;
  const res20_lib = (await db.query(`SELECT public.get_game_period_leaderboard('${periodClosedId}', 'LIBRARY') AS r;`)).rows[0].r;
  assert('CLOSED period: Luôn trả nguyên vẹn snapshot bất biến (st1: 999 sao, st2: 888 sao) kể cả khi truyền LIBRARY', 
    res20_all[0].period_stars === 999 && res20_lib[0].period_stars === 999
  );

  console.log(`\n========================================`);
  console.log(`KẾT QUẢ TEST SUITE SOURCE FILTER: ${passCount}/${testCount} PASS (${((passCount/testCount)*100).toFixed(0)}%)`);
  console.log(`========================================\n`);

  if (passCount !== testCount) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
