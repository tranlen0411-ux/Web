import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper khởi tạo instance PGlite sạch kèm DDL & RPC nạp sẵn
async function createFreshDb() {
  const db = new PGlite();

  // 1. Stubs
  await db.exec(`
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

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT current_setting('app.current_user_id', true)::uuid;
    $$;
  `);

  // 2. DDL 7 bảng
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      role TEXT,
      full_name TEXT,
      avatar_url TEXT
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
  `);

  // 3. Nạp RPC thật
  const sqlPath = path.resolve(__dirname, '../ADD_ACADEMIC_CLASS_LEADERBOARD.sql');
  const sqlContent = await fs.readFile(sqlPath, 'utf8');

  const startSignature = 'DROP FUNCTION IF EXISTS public.get_academic_class_leaderboard(UUID, TEXT, TEXT);';
  const startIdx = sqlContent.indexOf(startSignature);
  const grantSignature = 'GRANT EXECUTE ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) TO authenticated;';
  const grantIdx = sqlContent.indexOf(grantSignature, startIdx);

  const rpcSql = sqlContent.substring(startIdx, grantIdx + grantSignature.length);
  await db.exec(rpcSql);

  return db;
}

async function runScoringRulesTests() {
  const teacherId = 'a0000000-0000-0000-0000-000000000001';
  const classId = 'c0000000-0000-0000-0000-000000000001';
  const studentId = 'b0000000-0000-0000-0000-000000000001';

  try {
    // =========================================================================
    // NHÓM 1: KIỂM THỬ QUY TẮC CÂU HỎI TỰ LUẬN (ESSAY)
    // =========================================================================
    console.log('⏳ [1/4] Kiểm thử quy tắc câu hỏi tự luận (Essay)...');
    {
      const db = await createFreshDb();
      const exEssayId = 'e0000000-0000-0000-0000-000000000001';

      await db.exec(`
        INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherId}', 'teacher', 'Thầy Giáo A'),
        ('${studentId}', 'student', 'Học Sinh A');

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 5, '${teacherId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentId}');

        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${exEssayId}', 'Bài tập có tự luận', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${exEssayId}', '${classId}', '${teacherId}', NOW(), TRUE);

        -- 1 câu trắc nghiệm (5đ), 1 câu tự luận (5đ) -> tổng 10đ
        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${exEssayId}', 'multiple_choice', 5.0),
        ('${exEssayId}', 'essay', 5.0);
      `);

      await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

      // 1.1 Khi submission ở trạng thái 'submitted' (chưa chấm tự luận xong)
      await db.exec(`
        INSERT INTO public.academic_submissions (student_id, exercise_id, status, objective_score, total_score) VALUES
        ('${studentId}', '${exEssayId}', 'submitted', 5.0, NULL);
      `);

      let res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      let data = res.rows[0]?.result;
      let s = data.leaderboard.find(x => x.student_id === studentId);

      assert.strictEqual(data.success, true, 'Essay test 1.1: RPC phải thành công');
      assert.strictEqual(Number(data.total_valid_exercises), 1, 'Essay test 1.1: Tổng bài hợp lệ phải = 1');
      assert.strictEqual(
        Number(s.completed_count),
        0,
        `Essay test 1.1 FAIL: Bài có tự luận ở trạng thái 'submitted' KHÔNG được tính completed_count (mong đợi 0, nhận ${s.completed_count})`
      );
      assert.strictEqual(
        Number(s.total_earned_score),
        0,
        `Essay test 1.1 FAIL: Bài có tự luận ở trạng thái 'submitted' KHÔNG được tính điểm (mong đợi 0, nhận ${s.total_earned_score})`
      );

      // 1.2 Khi giáo viên đã chấm xong -> status = 'graded' (đạt 8.5đ)
      await db.exec(`
        UPDATE public.academic_submissions 
        SET status = 'graded', total_score = 8.5 
        WHERE student_id = '${studentId}' AND exercise_id = '${exEssayId}';
      `);

      res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      data = res.rows[0]?.result;
      s = data.leaderboard.find(x => x.student_id === studentId);

      assert.strictEqual(
        Number(s.completed_count),
        1,
        `Essay test 1.2 FAIL: Bài có tự luận khi đã 'graded' PHẢI được tính completed_count (mong đợi 1, nhận ${s.completed_count})`
      );
      assert.strictEqual(
        Number(s.total_earned_score),
        8.5,
        `Essay test 1.2 FAIL: Điểm sau khi graded phải là 8.5 (nhận ${s.total_earned_score})`
      );
      assert.strictEqual(
        Number(s.academic_score_pct),
        85.0,
        `Essay test 1.2 FAIL: academic_score_pct phải là 85.0% (nhận ${s.academic_score_pct})`
      );

      await db.close();
    }

    // =========================================================================
    // NHÓM 2: KIỂM THỬ CỜ COUNTS_TOWARD_RANKING (TRUE / FALSE)
    // =========================================================================
    console.log('⏳ [2/4] Kiểm thử cờ counts_toward_ranking (True / False)...');
    {
      const db = await createFreshDb();
      const exRanked = 'e0000000-0000-0000-0000-000000000001';
      const exUnranked = 'e0000000-0000-0000-0000-000000000002';

      await db.exec(`
        INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherId}', 'teacher', 'Thầy Giáo A'),
        ('${studentId}', 'student', 'Học Sinh A');

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 5, '${teacherId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentId}');

        -- Bài 1: counts_toward_ranking = TRUE (10đ)
        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${exRanked}', 'Bài tính điểm', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${exRanked}', '${classId}', '${teacherId}', NOW(), TRUE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${exRanked}', 'multiple_choice', 10.0);

        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentId}', '${exRanked}', 'graded', 10.0, 10.0);

        -- Bài 2: counts_toward_ranking = FALSE (10đ)
        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${exUnranked}', 'Bài luyện tập không xếp hạng', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${exUnranked}', '${classId}', '${teacherId}', NOW(), FALSE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${exUnranked}', 'multiple_choice', 10.0);

        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentId}', '${exUnranked}', 'graded', 10.0, 10.0);
      `);

      await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

      const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      const data = res.rows[0]?.result;
      const s = data.leaderboard.find(x => x.student_id === studentId);

      assert.strictEqual(data.success, true, 'Ranking Flag test: RPC phải thành công');
      assert.strictEqual(
        Number(data.total_valid_exercises),
        1,
        `Ranking Flag test FAIL: Bài có counts_toward_ranking=false không được tăng total_valid_exercises (mong đợi 1, nhận ${data.total_valid_exercises})`
      );
      assert.strictEqual(
        Number(data.total_class_max_score),
        10.0,
        `Ranking Flag test FAIL: total_class_max_score chỉ được tính bài có ranking=true (mong đợi 10.0, nhận ${data.total_class_max_score})`
      );
      assert.strictEqual(
        Number(s.completed_count),
        1,
        `Ranking Flag test FAIL: completed_count chỉ tính bài hợp lệ (mong đợi 1, nhận ${s.completed_count})`
      );
      assert.strictEqual(
        Number(s.total_earned_score),
        10.0,
        `Ranking Flag test FAIL: total_earned_score chỉ tính bài hợp lệ (mong đợi 10.0, nhận ${s.total_earned_score})`
      );
      assert.strictEqual(
        Number(s.academic_score_pct),
        100.0,
        `Ranking Flag test FAIL: academic_score_pct phải là 100.0% (nhận ${s.academic_score_pct})`
      );

      await db.close();
    }

    // =========================================================================
    // NHÓM 3: KIỂM THỬ LÀM NHIỀU LẦN (MULTIPLE ATTEMPTS - CHỈ LẤY ĐIỂM CAO NHẤT)
    // =========================================================================
    console.log('⏳ [3/4] Kiểm thử làm nhiều lần (Multiple attempts - Max score)...');
    {
      const db = await createFreshDb();
      const exId = 'e0000000-0000-0000-0000-000000000001';

      await db.exec(`
        INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherId}', 'teacher', 'Thầy Giáo A'),
        ('${studentId}', 'student', 'Học Sinh A');

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 5, '${teacherId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentId}');

        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${exId}', 'Bài tập làm nhiều lần', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${exId}', '${classId}', '${teacherId}', NOW(), TRUE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${exId}', 'multiple_choice', 10.0);

        -- Học sinh nộp 3 lần với các mức điểm: 5.0, 9.0, 7.0
        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentId}', '${exId}', 'graded', 5.0, 5.0),
        ('${studentId}', '${exId}', 'graded', 9.0, 9.0),
        ('${studentId}', '${exId}', 'graded', 7.0, 7.0);
      `);

      await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

      const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      const data = res.rows[0]?.result;
      const s = data.leaderboard.find(x => x.student_id === studentId);

      assert.strictEqual(data.success, true, 'Multiple attempts test: RPC phải thành công');
      assert.strictEqual(Number(data.total_valid_exercises), 1, 'Multiple attempts: total_valid_exercises phải là 1');
      assert.strictEqual(
        Number(s.completed_count),
        1,
        `Multiple attempts FAIL: completed_count phải là 1 (không bị cộng dồn số lần nộp), nhận được ${s.completed_count}`
      );
      assert.strictEqual(
        Number(s.total_earned_score),
        9.0,
        `Multiple attempts FAIL: total_earned_score phải lấy điểm cao nhất là 9.0, nhận được ${s.total_earned_score}`
      );
      assert.strictEqual(
        Number(s.academic_score_pct),
        90.0,
        `Multiple attempts FAIL: academic_score_pct phải là 90.0% (nhận ${s.academic_score_pct})`
      );

      await db.close();
    }

    // =========================================================================
    // NHÓM 4: KIỂM THỬ BỘ LỌC MÔN HỌC (SUBJECT FILTER)
    // =========================================================================
    console.log('⏳ [4/4] Kiểm thử bộ lọc môn học (Subject Filter)...');
    {
      const db = await createFreshDb();
      const exMath = 'e0000000-0000-0000-0000-000000000001';
      const exViet = 'e0000000-0000-0000-0000-000000000002';

      await db.exec(`
        INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherId}', 'teacher', 'Thầy Giáo A'),
        ('${studentId}', 'student', 'Học Sinh A');

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 5, '${teacherId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentId}');

        -- Bài 1: Môn Toán (10đ), học sinh đạt 8đ
        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${exMath}', 'Toán Phép Cộng', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${exMath}', '${classId}', '${teacherId}', NOW(), TRUE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${exMath}', 'multiple_choice', 10.0);

        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentId}', '${exMath}', 'graded', 8.0, 8.0);

        -- Bài 2: Môn Tiếng Việt (10đ), học sinh đạt 9đ
        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${exViet}', 'Tiếng Việt Tập Đọc', 'Tiếng Việt', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${exViet}', '${classId}', '${teacherId}', NOW(), TRUE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${exViet}', 'multiple_choice', 10.0);

        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentId}', '${exViet}', 'graded', 9.0, 9.0);
      `);

      await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

      // 4.1 Lọc p_subject = 'Toán'
      {
        const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'Toán') AS result;`);
        const data = res.rows[0]?.result;
        const s = data.leaderboard.find(x => x.student_id === studentId);

        assert.strictEqual(Number(data.total_valid_exercises), 1, 'Subject Toán: total_valid_exercises phải là 1');
        assert.strictEqual(Number(data.total_class_max_score), 10.0, 'Subject Toán: total_class_max_score phải là 10.0');
        assert.strictEqual(Number(s.total_earned_score), 8.0, 'Subject Toán: total_earned_score phải là 8.0');
        assert.strictEqual(Number(s.academic_score_pct), 80.0, 'Subject Toán: academic_score_pct phải là 80.0%');
      }

      // 4.2 Lọc p_subject = 'Tiếng Việt'
      {
        const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'Tiếng Việt') AS result;`);
        const data = res.rows[0]?.result;
        const s = data.leaderboard.find(x => x.student_id === studentId);

        assert.strictEqual(Number(data.total_valid_exercises), 1, 'Subject Tiếng Việt: total_valid_exercises phải là 1');
        assert.strictEqual(Number(data.total_class_max_score), 10.0, 'Subject Tiếng Việt: total_class_max_score phải là 10.0');
        assert.strictEqual(Number(s.total_earned_score), 9.0, 'Subject Tiếng Việt: total_earned_score phải là 9.0');
        assert.strictEqual(Number(s.academic_score_pct), 90.0, 'Subject Tiếng Việt: academic_score_pct phải là 90.0%');
      }

      // 4.3 Lọc p_subject = 'ALL' (Tính cả hai)
      {
        const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
        const data = res.rows[0]?.result;
        const s = data.leaderboard.find(x => x.student_id === studentId);

        assert.strictEqual(Number(data.total_valid_exercises), 2, 'Subject ALL: total_valid_exercises phải là 2');
        assert.strictEqual(Number(data.total_class_max_score), 20.0, 'Subject ALL: total_class_max_score phải là 20.0');
        assert.strictEqual(Number(s.total_earned_score), 17.0, 'Subject ALL: total_earned_score phải là 17.0 (8 + 9)');
        assert.strictEqual(Number(s.academic_score_pct), 85.0, 'Subject ALL: academic_score_pct phải là 85.0% (17 / 20 * 100)');
      }

      await db.close();
    }

    console.log('✅ PGLITE RPC SCORING RULES PASS');
  } catch (err) {
    console.error('❌ PGLITE RPC SCORING RULES FAIL:');
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

runScoringRulesTests();
