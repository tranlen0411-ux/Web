import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTimeBoundariesTest() {
  let db;
  try {
    // 1. Khởi tạo PGlite in-memory
    db = new PGlite();

    // 2. Tạo stubs
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

    // 3. Tạo DDL 7 bảng
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

    // 5. Khởi tạo Fixtures cơ bản
    const teacherId = 'a0000000-0000-0000-0000-000000000001';
    const classId = 'c0000000-0000-0000-0000-000000000001';
    const studentId = 'b0000000-0000-0000-0000-000000000001';

    await db.exec(`
      INSERT INTO public.profiles (id, role, full_name, avatar_url) VALUES
      ('${teacherId}', 'teacher', 'Thầy Giáo Phụ Trách', 'https://example.com/teacher.png'),
      ('${studentId}', 'student', 'Nguyễn Văn Học Sinh', 'https://example.com/s.png');

      INSERT INTO public.classes (id, name, grade_level, teacher_id) VALUES
      ('${classId}', 'Lớp 5A', 5, '${teacherId}');

      INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${classId}', '${studentId}');
    `);

    // Danh sách 6 mốc thời gian kiểm thử Boundary
    const testCases = [
      {
        id: 'e0000000-0000-0000-0000-000000000001',
        title: 'Ex1: Trước HK1 (2026-08-31 23:59:59+07)',
        timestamp: '2026-08-31 23:59:59+07',
        boundaryDesc: '2026-08-31T23:59:59+07:00 phải bị loại khỏi HK1, HK2, FULL_YEAR'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000002',
        title: 'Ex2: Bắt đầu HK1 (2026-09-01 00:00:00+07)',
        timestamp: '2026-09-01 00:00:00+07',
        boundaryDesc: '2026-09-01T00:00:00+07:00 phải được tính vào HK1, FULL_YEAR'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000003',
        title: 'Ex3: Kết thúc HK1 - 1 giây (2027-01-09 23:59:59+07)',
        timestamp: '2027-01-09 23:59:59+07',
        boundaryDesc: '2027-01-09T23:59:59+07:00 phải được tính vào HK1, FULL_YEAR'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000004',
        title: 'Ex4: Bắt đầu HK2 (2027-01-10 00:00:00+07)',
        timestamp: '2027-01-10 00:00:00+07',
        boundaryDesc: '2027-01-10T00:00:00+07:00 phải được tính vào HK2, FULL_YEAR và loại khỏi HK1'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000005',
        title: 'Ex5: Kết thúc HK2 - 1 ngày (2027-05-30 23:59:59+07)',
        timestamp: '2027-05-30 23:59:59+07',
        boundaryDesc: '2027-05-30T23:59:59+07:00 phải được tính vào HK2, FULL_YEAR'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000006',
        title: 'Ex6: Kết thúc HK2 / Năm học (2027-05-31 00:00:00+07)',
        timestamp: '2027-05-31 00:00:00+07',
        boundaryDesc: '2027-05-31T00:00:00+07:00 phải bị loại khỏi HK1, HK2, FULL_YEAR'
      }
    ];

    // Nạp 6 bài tập tương ứng 6 mốc
    for (const tc of testCases) {
      await db.exec(`
        INSERT INTO public.academic_exercises (id, title, subject, status, class_id, teacher_id) VALUES
        ('${tc.id}', '${tc.title}', 'Toán', 'published', '${classId}', '${teacherId}');

        INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, counts_toward_ranking) VALUES
        ('${tc.id}', '${classId}', '${teacherId}', TIMESTAMPTZ '${tc.timestamp}', TRUE);

        INSERT INTO public.academic_exercise_questions (exercise_id, question_type, points) VALUES
        ('${tc.id}', 'multiple_choice', 10.0);

        INSERT INTO public.academic_submissions (student_id, exercise_id, status, total_score, objective_score) VALUES
        ('${studentId}', '${tc.id}', 'graded', 10.0, 10.0);
      `);
    }

    // Đặt auth.uid() = teacher
    await db.exec(`SELECT set_config('app.current_user_id', '${teacherId}', false);`);

    // Helper gọi RPC theo time_range
    async function callRpc(timeRange) {
      const res = await db.query(`
        SELECT public.get_academic_class_leaderboard('${classId}', '${timeRange}', 'ALL') AS result;
      `);
      return res.rows[0]?.result;
    }

    // 6. KIỂM THỬ TỪNG MỐC & BOUNDARY

    // A. time_range = 'HK1' (Bao gồm Ex2, Ex3 -> đúng 2 bài)
    {
      const r_hk1 = await callRpc('HK1');
      assert.strictEqual(r_hk1?.success, true, 'HK1 RPC phải trả về success: true');
      assert.strictEqual(
        Number(r_hk1?.total_valid_exercises),
        2,
        `Boundary HK1 sai: mong đợi 2 bài (Ex2, Ex3), nhận được ${r_hk1?.total_valid_exercises}`
      );
      assert.strictEqual(
        Number(r_hk1?.total_class_max_score),
        20.0,
        `Tổng điểm tối đa HK1 sai: mong đợi 20.0, nhận được ${r_hk1?.total_class_max_score}`
      );
    }

    // B. time_range = 'SEMESTER' (Alias của HK1 -> đúng 2 bài giống HK1)
    {
      const r_sem = await callRpc('SEMESTER');
      assert.strictEqual(r_sem?.success, true, 'SEMESTER RPC phải trả về success: true');
      assert.strictEqual(
        Number(r_sem?.total_valid_exercises),
        2,
        `Alias SEMESTER sai: mong đợi 2 bài giống HK1, nhận được ${r_sem?.total_valid_exercises}`
      );
    }

    // C. time_range = 'HK2' (Bao gồm Ex4, Ex5 -> đúng 2 bài)
    {
      const r_hk2 = await callRpc('HK2');
      assert.strictEqual(r_hk2?.success, true, 'HK2 RPC phải trả về success: true');
      assert.strictEqual(
        Number(r_hk2?.total_valid_exercises),
        2,
        `Boundary HK2 sai: mong đợi 2 bài (Ex4, Ex5), nhận được ${r_hk2?.total_valid_exercises}`
      );
      assert.strictEqual(
        Number(r_hk2?.total_class_max_score),
        20.0,
        `Tổng điểm tối đa HK2 sai: mong đợi 20.0, nhận được ${r_hk2?.total_class_max_score}`
      );
    }

    // D. time_range = 'FULL_YEAR' (Bao gồm Ex2, Ex3, Ex4, Ex5 -> đúng 4 bài)
    {
      const r_fy = await callRpc('FULL_YEAR');
      assert.strictEqual(r_fy?.success, true, 'FULL_YEAR RPC phải trả về success: true');
      assert.strictEqual(
        Number(r_fy?.total_valid_exercises),
        4,
        `Boundary FULL_YEAR sai: mong đợi 4 bài (Ex2..Ex5), nhận được ${r_fy?.total_valid_exercises}`
      );
      assert.strictEqual(
        Number(r_fy?.total_class_max_score),
        40.0,
        `Tổng điểm tối đa FULL_YEAR sai: mong đợi 40.0, nhận được ${r_fy?.total_class_max_score}`
      );
    }

    // E. time_range = 'ALL' (Không bị giới hạn mốc -> gồm đủ cả 6 bài)
    {
      const r_all = await callRpc('ALL');
      assert.strictEqual(r_all?.success, true, 'ALL RPC phải trả về success: true');
      assert.strictEqual(
        Number(r_all?.total_valid_exercises),
        6,
        `Bộ lọc ALL sai: mong đợi đủ 6 bài, nhận được ${r_all?.total_valid_exercises}`
      );
      assert.strictEqual(
        Number(r_all?.total_class_max_score),
        60.0,
        `Tổng điểm tối đa ALL sai: mong đợi 60.0, nhận được ${r_all?.total_class_max_score}`
      );
    }

    await db.close();
    console.log('✅ PGLITE RPC TIME BOUNDARIES PASS');
  } catch (err) {
    console.error('❌ PGLITE RPC TIME BOUNDARIES FAIL:');
    console.error(err.message || err);
    if (db) {
      try {
        await db.close();
      } catch (_) {}
    }
    process.exitCode = 1;
  }
}

runTimeBoundariesTest();
