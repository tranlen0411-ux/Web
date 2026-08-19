import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBasicRuntimeTest() {
  let db;
  try {
    // 1. Khởi tạo PGlite in-memory
    db = new PGlite();

    // 2. Tạo stubs (roles anon, authenticated, schema auth, function auth.uid())
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

    // 3. Tạo DDL 7 bảng tối thiểu mà RPC sử dụng
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

    // 4. Đọc và nạp RPC thật từ ADD_ACADEMIC_CLASS_LEADERBOARD.sql
    const sqlPath = path.resolve(__dirname, '../ADD_ACADEMIC_CLASS_LEADERBOARD.sql');
    const sqlContent = await fs.readFile(sqlPath, 'utf8');

    const startSignature = 'DROP FUNCTION IF EXISTS public.get_academic_class_leaderboard(UUID, TEXT, TEXT);';
    const startIdx = sqlContent.indexOf(startSignature);
    if (startIdx === -1) {
      throw new Error(`Không tìm thấy chữ ký khởi đầu của RPC trong ${sqlPath}`);
    }

    const grantSignature = 'GRANT EXECUTE ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) TO authenticated;';
    const grantIdx = sqlContent.indexOf(grantSignature, startIdx);
    if (grantIdx === -1) {
      throw new Error(`Không tìm thấy lệnh GRANT của RPC trong ${sqlPath}`);
    }

    const rpcSql = sqlContent.substring(startIdx, grantIdx + grantSignature.length);
    await db.exec(rpcSql);

    // 5. Tạo Fixture tối thiểu
    const teacherId = 'a0000000-0000-0000-0000-000000000001';
    const classId = 'c0000000-0000-0000-0000-000000000001';
    const student1Id = 'b0000000-0000-0000-0000-000000000001';
    const student2Id = 'b0000000-0000-0000-0000-000000000002';
    const exerciseId = 'e0000000-0000-0000-0000-000000000001';

    // 1 giáo viên, 2 học sinh
    await db.query(`
      INSERT INTO public.profiles (id, role, full_name, avatar_url) VALUES
      ('${teacherId}', 'teacher', 'Thầy Giáo Phụ Trách', 'https://example.com/teacher.png'),
      ('${student1Id}', 'student', 'Nguyễn Văn Học Sinh 1', 'https://example.com/s1.png'),
      ('${student2Id}', 'student', 'Trần Thị Học Sinh 2', 'https://example.com/s2.png');
    `);

    // 1 lớp học do giáo viên phụ trách
    await db.query(`
      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
      ('${classId}', 'Lớp 5A', 5, '${teacherId}');
    `);

    // 2 học sinh thuộc lớp
    await db.query(`
      INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${classId}', '${student1Id}'),
      ('${classId}', '${student2Id}');
    `);

    // 1 bài tập published
    await db.query(`
      INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
      ('${exerciseId}', 'Bài tập Toán ôn tập 1', 'Toán', 'published', '${classId}', '${teacherId}');
    `);

    // Giao bài với counts_toward_ranking = true
    await db.query(`
      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
      ('${exerciseId}', '${classId}', '${teacherId}', NOW(), TRUE);
    `);

    // 2 câu hỏi objective có điểm (mỗi câu 5đ -> tổng điểm bài = 10đ)
    await db.query(`
      INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
      ('${exerciseId}', 'multiple_choice', 5.0),
      ('${exerciseId}', 'single_choice', 5.0);
    `);

    // Submissions hợp lệ: Học sinh 1 đạt 10.0đ, Học sinh 2 đạt 6.0đ
    await db.query(`
      INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
      ('${student1Id}', '${exerciseId}', 'graded', 10.0, 10.0),
      ('${student2Id}', '${exerciseId}', 'graded', 6.0, 6.0);
    `);

    // 6. Đặt auth.uid() = giáo viên của lớp
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

    // 7. Gọi trực tiếp RPC
    const rpcResult = await db.query(`
      SELECT public.get_academic_class_leaderboard('${classId}', 'ALL', 'ALL') AS result;
    `);

    const json = rpcResult.rows[0]?.result;

    // 8. Assert các contract cơ bản
    if (!json || typeof json !== 'object') {
      throw new Error(`RPC không trả về JSON object: ${JSON.stringify(json)}`);
    }

    if (json.success !== true) {
      throw new Error(`RPC trả về success !== true: ${JSON.stringify(json)}`);
    }

    if (!json.class_info || json.class_info.class_id !== classId) {
      throw new Error(`class_info không hợp lệ: ${JSON.stringify(json.class_info)}`);
    }

    if (!Array.isArray(json.leaderboard)) {
      throw new Error(`leaderboard không phải là mảng: ${JSON.stringify(json.leaderboard)}`);
    }

    if (json.leaderboard.length !== 2) {
      throw new Error(`leaderboard phải có đúng 2 học sinh, nhưng có ${json.leaderboard.length}`);
    }

    if (Number(json.total_valid_exercises) !== 1) {
      throw new Error(`total_valid_exercises phải bằng 1, nhận được: ${json.total_valid_exercises}`);
    }

    if (json.total_class_max_score === undefined || json.total_class_max_score === null || Number(json.total_class_max_score) <= 0) {
      throw new Error(`total_class_max_score không hợp lệ: ${json.total_class_max_score}`);
    }

    const [top1, top2] = json.leaderboard;

    if (!top1.rank || !top2.rank) {
      throw new Error(`Mỗi học sinh phải có rank: top1=${top1.rank}, top2=${top2.rank}`);
    }

    if (top1.student_id !== student1Id || top2.student_id !== student2Id) {
      throw new Error(`Học sinh điểm cao (10đ) phải đứng đầu, học sinh điểm thấp (6đ) phải đứng sau. Nhận được: top1=${top1.student_id}, top2=${top2.student_id}`);
    }

    if (top1.rank >= top2.rank) {
      throw new Error(`Thứ hạng top1 (${top1.rank}) phải cao hơn top2 (${top2.rank})`);
    }

    await db.close();
    console.log('✅ PGLITE RPC BASIC RUNTIME PASS');
  } catch (err) {
    console.error('❌ PGLITE RPC BASIC RUNTIME FAIL:', err.message || err);
    if (db) {
      try {
        await db.close();
      } catch (_) {}
    }
    process.exitCode = 1;
  }
}

runBasicRuntimeTest();
