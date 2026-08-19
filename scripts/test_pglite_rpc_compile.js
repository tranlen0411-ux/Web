import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runRpcCompileTest() {
  let db;
  try {
    // 1. Khởi tạo PGlite in-memory
    db = new PGlite();

    // 2. Tạo role anon, authenticated, schema auth và function auth.uid() stub
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

    // 3. Tạo 7 bảng tối thiểu với đúng tên cột và kiểu dữ liệu mà RPC sử dụng
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

    // 4. Đọc ADD_ACADEMIC_CLASS_LEADERBOARD.sql và trích xuất phần định nghĩa get_academic_class_leaderboard
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

    // 5. Nạp và compile RPC vào PGlite
    await db.exec(rpcSql);

    // 6. Xác nhận function đã được tạo thành công trong pg_proc
    const verifyRes = await db.query(`
      SELECT p.proname, n.nspname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_academic_class_leaderboard';
    `);

    if (!verifyRes || !verifyRes.rows || verifyRes.rows.length === 0) {
      throw new Error('Không tìm thấy function public.get_academic_class_leaderboard trong catalog pg_proc sau khi nạp.');
    }

    await db.close();
    console.log('✅ PGLITE RPC COMPILE PASS');
  } catch (err) {
    console.error('❌ PGLITE RPC COMPILE FAIL:', err.message || err);
    if (db) {
      try {
        await db.close();
      } catch (_) {}
    }
    process.exitCode = 1;
  }
}

runRpcCompileTest();
