import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper tạo DB PGlite in-memory kèm DDL và nạp RPC thật
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
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
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

async function runSecurityAndEdgeCaseTests() {
  try {
    // =========================================================================
    // NHÓM 1: KIỂM THỬ PHÂN QUYỀN PHỦ ĐỊNH & HỢP LỆ (NEGATIVE PERMISSIONS)
    // =========================================================================
    console.log('⏳ [1/3] Kiểm thử phân quyền (Negative Permissions & Valid Teacher)...');
    {
      const db = await createFreshDb();

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

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 5, '${teacherOwnerId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentInClassId}');
      `);

      // 1.1 auth.uid() = NULL (Chưa đăng nhập) -> Phải bị từ chối
      await db.exec(`SELECT set_config('app.current_user_id', '', false);`);
      let res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      let data = res.rows[0]?.result;
      assert.strictEqual(data.success, false, '1.1 auth.uid() = NULL phải trả về success: false');
      assert.match(data.message, /chưa đăng nhập/i, '1.1 Thông báo lỗi phải chứa "Chưa đăng nhập"');

      // 1.2 Học sinh không thuộc lớp -> Phải bị từ chối
      await db.exec(`SELECT set_config('app.current_user_id', '${studentOutClassId}', false);`);
      res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      data = res.rows[0]?.result;
      assert.strictEqual(data.success, false, '1.2 Học sinh ngoài lớp phải trả về success: false');
      assert.match(data.message, /lớp mình đang tham gia/i, '1.2 Thông báo lỗi phải báo chỉ được xem lớp mình');

      // 1.3 Giáo viên không phụ trách lớp -> Phải bị từ chối
      await db.exec(`SELECT set_config('app.current_user_id', '${teacherOtherId}', false);`);
      res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      data = res.rows[0]?.result;
      assert.strictEqual(data.success, false, '1.3 Giáo viên không phụ trách phải trả về success: false');
      assert.match(data.message, /do mình phụ trách/i, '1.3 Thông báo lỗi phải báo chỉ xem lớp mình phụ trách');

      // 1.4 Giáo viên phụ trách lớp -> Phải được phép
      await db.exec(`SELECT set_config('app.current_user_id', '${teacherOwnerId}', false);`);
      res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      data = res.rows[0]?.result;
      assert.strictEqual(data.success, true, '1.4 Giáo viên phụ trách lớp PHẢI được phép (success: true)');

      await db.close();
    }

    // =========================================================================
    // NHÓM 2: KIỂM THỬ HÒA ĐIỂM (TIE / DENSE_RANK / SECONDARY CRITERIA)
    // =========================================================================
    console.log('⏳ [2/3] Kiểm thử xếp hạng hòa điểm (Tie, DENSE_RANK, is_tied, Secondary criteria)...');
    {
      const db = await createFreshDb();

      const teacherId = 'a0000000-0000-0000-0000-000000000001';
      const classId = 'c0000000-0000-0000-0000-000000000001';
      const studentAId = 'b0000000-0000-0000-0000-000000000001'; // An (10đ, 100%)
      const studentBId = 'b0000000-0000-0000-0000-000000000002'; // Bình (10đ, 100%) -> Hòa An
      const studentCId = 'b0000000-0000-0000-0000-000000000003'; // Cường (7đ, 70%) -> Hạng 2
      const studentDId = 'b0000000-0000-0000-0000-000000000004'; // Dũng (0đ, 0%) -> Hạng 3
      const ex1Id = 'e0000000-0000-0000-0000-000000000001';

      await db.exec(`
        INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherId}', 'teacher', 'Thầy Phụ Trách'),
        ('${studentAId}', 'student', 'Nguyễn Văn An'),
        ('${studentBId}', 'student', 'Trần Văn Bình'),
        ('${studentCId}', 'student', 'Lê Văn Cường'),
        ('${studentDId}', 'student', 'Phạm Văn Dũng');

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 5, '${teacherId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentAId}'),
        ('${classId}', '${studentBId}'),
        ('${classId}', '${studentCId}'),
        ('${classId}', '${studentDId}');

        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${ex1Id}', 'Bài kiểm tra 10đ', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${ex1Id}', '${classId}', '${teacherId}', NOW(), TRUE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${ex1Id}', 'multiple_choice', 10.0);

        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentAId}', '${ex1Id}', 'graded', 10.0, 10.0),
        ('${studentBId}', '${ex1Id}', 'graded', 10.0, 10.0),
        ('${studentCId}', '${ex1Id}', 'graded', 7.0, 7.0);
        -- Dũng không nộp bài (0đ)
      `);

      await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
      const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      const data = res.rows[0]?.result;

      assert.strictEqual(data.success, true, 'Tie test: RPC phải thành công');
      assert.strictEqual(data.leaderboard.length, 4, 'Tie test: Bảng xếp hạng phải có đủ 4 học sinh');

      const rankA = data.leaderboard.find(x => x.student_id === studentAId);
      const rankB = data.leaderboard.find(x => x.student_id === studentBId);
      const rankC = data.leaderboard.find(x => x.student_id === studentCId);
      const rankD = data.leaderboard.find(x => x.student_id === studentDId);

      // 2.1 An và Bình cùng 100% -> DENSE_RANK = 1, is_tied = true
      assert.strictEqual(Number(rankA.rank), 1, 'Học sinh An phải rank #1');
      assert.strictEqual(Number(rankB.rank), 1, 'Học sinh Bình phải rank #1');
      assert.strictEqual(rankA.is_tied, true, 'An phải có cờ is_tied = true');
      assert.strictEqual(rankB.is_tied, true, 'Bình phải có cờ is_tied = true');

      // 2.2 Cường 70% -> DENSE_RANK = 2, is_tied = false
      assert.strictEqual(Number(rankC.rank), 2, 'Học sinh Cường phải rank #2 (DENSE_RANK)');
      assert.strictEqual(rankC.is_tied, false, 'Cường phải có cờ is_tied = false');

      // 2.3 Dũng 0% -> DENSE_RANK = 3, is_tied = false
      assert.strictEqual(Number(rankD.rank), 3, 'Học sinh Dũng phải rank #3 (DENSE_RANK)');
      assert.strictEqual(rankD.is_tied, false, 'Dũng phải có cờ is_tied = false');

      // 2.4 Kiểm tra thứ tự xuất hiện trong JSON (đồng hạng thì sắp xếp theo full_name ASC: An đứng trước Bình)
      assert.strictEqual(data.leaderboard[0].student_id, studentAId, 'An (A) phải xếp trước Bình (B) theo tên');
      assert.strictEqual(data.leaderboard[1].student_id, studentBId, 'Bình phải xếp ở vị trí thứ 2 trong mảng');

      await db.close();
    }

    // =========================================================================
    // NHÓM 3: KIỂM THỬ KHÔNG CÓ BÀI TẬP NÀO HỢP LỆ (ZERO VALID EXERCISES)
    // =========================================================================
    console.log('⏳ [3/3] Kiểm thử lớp không có bài tập hợp lệ (Zero valid exercises)...');
    {
      const db = await createFreshDb();

      const teacherId = 'a0000000-0000-0000-0000-000000000001';
      const classId = 'c0000000-0000-0000-0000-000000000001';
      const student1Id = 'b0000000-0000-0000-0000-000000000001';
      const student2Id = 'b0000000-0000-0000-0000-000000000002';

      await db.exec(`
        INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherId}', 'teacher', 'Thầy Giáo A'),
        ('${student1Id}', 'student', 'Học Sinh 1'),
        ('${student2Id}', 'student', 'Học Sinh 2');

        INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A Mới Tạo', 5, '${teacherId}');

        INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${student1Id}'),
        ('${classId}', '${student2Id}');
        -- KHÔNG có bài tập nào được giao hoặc xuất bản
      `);

      await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);
      const res = await db.query(`SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;`);
      const data = res.rows[0]?.result;

      assert.strictEqual(data.success, true, 'Zero exercises test: RPC phải thành công và không lỗi chia cho 0');
      assert.strictEqual(Number(data.total_valid_exercises), 0, 'total_valid_exercises phải là 0');
      assert.strictEqual(Number(data.total_class_max_score), 0, 'total_class_max_score phải là 0');
      assert.strictEqual(data.leaderboard.length, 2, 'leaderboard vẫn phải trả về đủ 2 học sinh của lớp');

      for (const st of data.leaderboard) {
        assert.strictEqual(Number(st.academic_score_pct), 0, 'academic_score_pct phải an toàn là 0');
        assert.strictEqual(Number(st.completion_rate_pct), 0, 'completion_rate_pct phải an toàn là 0');
        assert.strictEqual(Number(st.avg_score), 0, 'avg_score phải an toàn là 0');
        assert.strictEqual(Number(st.completed_count), 0, 'completed_count phải là 0');
        assert.strictEqual(Number(st.total_earned_score), 0, 'total_earned_score phải là 0');
      }

      await db.close();
    }

    console.log('✅ PGLITE RPC SECURITY & EDGE CASES PASS');
  } catch (err) {
    console.error('❌ PGLITE RPC SECURITY & EDGE CASES FAIL:');
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

runSecurityAndEdgeCaseTests();
