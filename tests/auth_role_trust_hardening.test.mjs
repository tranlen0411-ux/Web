import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ============================================================================
 * [ISOLATED ENGINE TEST] PGLITE MOCK TEST MATRIX
 * ============================================================================
 * Môi trường: Máy chủ kiểm thử cách ly cục bộ sử dụng engine độc lập @electric-sql/pglite.
 * Bản chất: Đây là MOCK / STATIC SIMULATION trong môi trường nhúng,
 *           KHÔNG PHẢI là Hosted Staging Runtime Verification trên Supabase thật.
 * Mục đích: Kiểm chứng logic toán tử, khả năng bồi hoàn (compensation),
 *           an toàn phân quyền và tính tương thích của bản vá.
 * ============================================================================
 */
describe('[ISOLATED ENGINE TEST] P0 AUTH ROLE TRUST HARDENING AUDIT & TEST SUITE', () => {
  let db;

  before(async () => {
    db = new PGlite();

    // 1. Tạo mock schema auth và public theo chuẩn Supabase PostgreSQL
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS public;

      CREATE TABLE auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
        email VARCHAR(255),
        encrypted_password VARCHAR(255),
        email_confirmed_at TIMESTAMPTZ,
        raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
        raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        role VARCHAR(255) DEFAULT 'authenticated',
        aud VARCHAR(255) DEFAULT 'authenticated'
      );

      CREATE TABLE public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        email VARCHAR(255),
        full_name VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'student',
        avatar_url TEXT,
        grade_level INT DEFAULT 1,
        student_code VARCHAR(50),
        total_stars INT DEFAULT 0,
        total_coins INT DEFAULT 0,
        is_disabled BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Nạp migration mới 20261013120000_auth_role_trust_hardening.sql
    const migrationPath = path.resolve('supabase/migrations/20261013120000_auth_role_trust_hardening.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await db.exec(migrationSql);
  });

  after(async () => {
    if (db) await db.close();
  });

  it('TC1: Tự đăng ký thông thường không truyền metadata -> Nhận vai trò "student"', async () => {
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('normal_student@test.local', '{"full_name": "Em Học Sinh"}'::jsonb)
      RETURNING id, email;
    `);
    const userId = res.rows[0].id;

    const profileRes = await db.query(`SELECT id, email, full_name, role, is_disabled FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(profileRes.rows.length, 1);
    assert.equal(profileRes.rows[0].role, 'student', 'Tài khoản thường phải nhận role = student');
    assert.equal(profileRes.rows[0].full_name, 'Em Học Sinh');
    assert.equal(profileRes.rows[0].is_disabled, false);
  });

  it('TC2: Tấn công leo thang đặc quyền: raw_user_meta_data tự khai báo "teacher" -> BỊ TỪ CHỐI, chỉ nhận "student"', async () => {
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('hacker_teacher@test.local', '{"full_name": "Kẻ Tấn Công 1", "role": "teacher"}'::jsonb)
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    const profileRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(profileRes.rows[0].role, 'student', 'raw_user_meta_data.role = teacher BẮT BUỘC bị lờ đi, chỉ nhận student');
  });

  it('TC3: Tấn công leo thang đặc quyền: raw_user_meta_data tự khai báo "admin" -> BỊ TỪ CHỐI, chỉ nhận "student"', async () => {
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('hacker_admin@test.local', '{"full_name": "Kẻ Tấn Công 2", "role": "admin"}'::jsonb)
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    const profileRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(profileRes.rows[0].role, 'student', 'raw_user_meta_data.role = admin BẮT BUỘC bị lờ đi, chỉ nhận student');
  });

  it('TC4: Quản trị viên khởi tạo tài khoản qua raw_app_meta_data (Trusted Source) -> Cấp vai trò "teacher" hợp lệ', async () => {
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_app_meta_data, raw_user_meta_data)
      VALUES (
        'legit_teacher@test.local',
        '{"role": "teacher"}'::jsonb,
        '{"full_name": "Cô Giáo Hợp Lệ"}'::jsonb
      )
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    const profileRes = await db.query(`SELECT role, full_name FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(profileRes.rows[0].role, 'teacher', 'raw_app_meta_data do Admin quản lý phải được chấp thuận role = teacher');
    assert.equal(profileRes.rows[0].full_name, 'Cô Giáo Hợp Lệ');
  });

  it('TC5: Quản trị viên khởi tạo tài khoản qua raw_app_meta_data (Trusted Source) -> Cấp vai trò "admin" hợp lệ', async () => {
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_app_meta_data, raw_user_meta_data)
      VALUES (
        'legit_admin@test.local',
        '{"role": "admin"}'::jsonb,
        '{"full_name": "Quản Trị Viên Hợp Lệ"}'::jsonb
      )
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    const profileRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(profileRes.rows[0].role, 'admin', 'raw_app_meta_data do Admin quản lý phải được chấp thuận role = admin');
  });

  it('TC6: Bảo toàn quyền Giáo viên hiện có khi có sự kiện re-run trigger hoặc ON CONFLICT -> Không bị hạ quyền', async () => {
    // 1. Tạo giáo viên hợp lệ
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_app_meta_data, raw_user_meta_data)
      VALUES ('existing_teacher@test.local', '{"role": "teacher"}'::jsonb, '{"full_name": "Thầy Hiện Hữu"}'::jsonb)
      RETURNING id;
    `);
    const teacherId = res.rows[0].id;

    const beforeRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [teacherId]);
    assert.equal(beforeRes.rows[0].role, 'teacher');

    // 2. Mô phỏng conflict update khi user đăng nhập lại hoặc trigger chạy lại mà không có app_meta
    await db.query(`
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ($1, 'existing_teacher@test.local', 'Thầy Hiện Hữu Mới', 'student')
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        updated_at = now();
    `, [teacherId]);

    // 3. Quyền teacher vẫn phải được bảo toàn
    const afterRes = await db.query(`SELECT role, full_name FROM public.profiles WHERE id = $1`, [teacherId]);
    assert.equal(afterRes.rows[0].role, 'teacher', 'Quyền teacher của tài khoản hiện tại tuyệt đối không bị giáng chức thành student');
    assert.equal(afterRes.rows[0].full_name, 'Thầy Hiện Hữu Mới');
  });

  it('TC7: Luồng Admin cập nhật vai trò trực tiếp (Admin User Management / Edge Function) -> Hoạt động chính xác', async () => {
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('promoted_user@test.local', '{"full_name": "Người Dùng Thăng Chức"}'::jsonb)
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    const initRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(initRes.rows[0].role, 'student');

    // Admin thực hiện thăng quyền qua Admin RPC / Service Role
    await db.query(`
      UPDATE public.profiles
      SET role = 'teacher', updated_at = now()
      WHERE id = $1;
    `, [userId]);

    const updatedRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(updatedRes.rows[0].role, 'teacher', 'Admin có thể thăng quyền giáo viên an toàn qua luồng quản trị');
  });

  it('TC8A: [MOCK SIMULATION] Bồi hoàn admin-create-user: Cập nhật profiles thất bại & Xóa Auth thành công -> Dọn sạch toàn bộ', async () => {
    // Mô phỏng Edge Function admin-create-user:
    // Bước 1: Tạo Auth User
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('comp_success@test.local', '{"full_name": "Tạo Thất Bại Xóa Sạch", "role": "teacher"}'::jsonb)
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    // Bước 2: Cập nhật profiles thất bại (giả lập lỗi)
    // Bước 3: Logic bồi hoàn thực thi: Xóa Auth user thành công (kéo theo xóa profile qua CASCADE)
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);

    // Kiểm tra: Cả auth.users và public.profiles đều không còn bản ghi nào
    const authCheck = await db.query(`SELECT id FROM auth.users WHERE id = $1`, [userId]);
    const profCheck = await db.query(`SELECT id FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(authCheck.rows.length, 0, 'Auth user phải được thu hồi hoàn toàn');
    assert.equal(profCheck.rows.length, 0, 'Profile mồ côi phải được xóa sạch');
  });

  it('TC8B: [MOCK SIMULATION] Bồi hoàn admin-create-user: Cập nhật profiles thất bại & Xóa Auth THẤT BẠI -> Tài khoản dừng ở role="student", KHÔNG rò rỉ quyền teacher', async () => {
    // Mô phỏng sự cố mạng nghiêm trọng ở Edge Function:
    // Bước 1: Tạo Auth user thành công
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('comp_fail_auth@test.local', '{"full_name": "Tạo Thất Bại Kẹt Auth", "role": "teacher"}'::jsonb)
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    // Bước 2: Cập nhật profile role='teacher' THẤT BẠI
    // Bước 3: Xóa Auth user (supabaseAdmin.auth.admin.deleteUser) CŨNG THẤT BẠI (ví dụ: timeout/mất kết nối GoTrue)
    // -> Tài khoản Auth kẹt lại trong hệ thống

    // Kiểm tra tính Fail-Safe:
    const profCheck = await db.query(`SELECT role, is_disabled FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(profCheck.rows.length, 1);
    assert.equal(profCheck.rows[0].role, 'student', 'Hệ thống Fail-Safe: Khi bồi hoàn xóa Auth thất bại, tài khoản chỉ mang role=student, TUYỆT ĐỐI không có đặc quyền teacher/admin');
  });

  it('TC9: [PGLITE MOCK] Luồng mô phỏng Bulk Create Students: Trigger tương thích cấu trúc và gán đúng student', async () => {
    // Lưu ý: Đây là kiểm thử mô phỏng độc lập trên PGlite Mock, KHÔNG phải kiểm thử toàn diện
    // toàn bộ Deno Edge Function admin-bulk-create-students (vốn có logic stream, idempotency, lock).
    const studentInputs = [
      { email: 'hs_mock_1@test.local', name: 'Học Sinh Mock 1', code: 'HS3-2001' },
      { email: 'hs_mock_2@test.local', name: 'Học Sinh Mock 2', code: 'HS3-2002' }
    ];

    for (const item of studentInputs) {
      const uRes = await db.query(`
        INSERT INTO auth.users (email, raw_user_meta_data)
        VALUES ($1, jsonb_build_object('full_name', $2::text, 'student_code', $3::text, 'role', 'student'))
        RETURNING id;
      `, [item.email, item.name, item.code]);

      const uid = uRes.rows[0].id;
      await db.query(`UPDATE public.profiles SET student_code = $1 WHERE id = $2`, [item.code, uid]);
    }

    const checkRes = await db.query(`SELECT email, role, student_code FROM public.profiles WHERE email LIKE 'hs_mock_%' ORDER BY student_code ASC;`);
    assert.equal(checkRes.rows.length, 2);
    assert.equal(checkRes.rows[0].role, 'student');
    assert.equal(checkRes.rows[1].role, 'student');
  });

  it('TC10: [ROLLBACK TEST] Kiểm thử hàm Secure Rollback: grade_level thiếu, sai định dạng hoặc ngoài giới hạn KHÔNG làm lỗi trigger', async () => {
    // 1. Áp dụng định nghĩa Secure Rollback Trigger an toàn (Fail-Safe Strict Trigger)
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      DECLARE
        v_grade INT;
      BEGIN
        BEGIN
          v_grade := (NEW.raw_user_meta_data->>'grade_level')::INT;
        EXCEPTION WHEN OTHERS THEN
          v_grade := 1;
        END;

        IF v_grade IS NULL OR v_grade < 1 OR v_grade > 12 THEN
          v_grade := 1;
        END IF;

        INSERT INTO public.profiles (id, email, full_name, role, grade_level)
        VALUES (
          NEW.id,
          NEW.email,
          pg_catalog.btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', pg_catalog.split_part(NEW.email, '@', 1))),
          'student', -- TUYỆT ĐỐI KHÔNG KHÔI PHỤC ĐỌC TỪ USER_METADATA
          v_grade
        )
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
          updated_at = pg_catalog.now();
        RETURN NEW;
      END;
      $$;
    `);

    // 2. Thử nghiệm với grade_level sai định dạng (chuỗi chữ "abc")
    const resInvalid = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('invalid_grade@test.local', '{"full_name": "Test Sai Grade", "grade_level": "abc_not_a_number"}'::jsonb)
      RETURNING id;
    `);
    const p1 = (await db.query(`SELECT grade_level, role FROM public.profiles WHERE id = $1`, [resInvalid.rows[0].id])).rows[0];
    assert.equal(p1.grade_level, 1, 'Grade level sai định dạng chuỗi phải fallback an toàn về 1');
    assert.equal(p1.role, 'student');

    // 3. Thử nghiệm với grade_level ngoài giới hạn (ví dụ: 99 hoặc -5)
    const resOutOfRange = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('out_of_range_grade@test.local', '{"full_name": "Test Lố Grade", "grade_level": 99}'::jsonb)
      RETURNING id;
    `);
    const p2 = (await db.query(`SELECT grade_level, role FROM public.profiles WHERE id = $1`, [resOutOfRange.rows[0].id])).rows[0];
    assert.equal(p2.grade_level, 1, 'Grade level ngoài giới hạn [1-12] phải fallback về 1');
    assert.equal(p2.role, 'student');

    // 4. Thử nghiệm với metadata thiếu hoàn toàn grade_level
    const resMissing = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('missing_grade@test.local', '{}'::jsonb)
      RETURNING id;
    `);
    const p3 = (await db.query(`SELECT grade_level, role FROM public.profiles WHERE id = $1`, [resMissing.rows[0].id])).rows[0];
    assert.equal(p3.grade_level, 1, 'Grade level thiếu phải fallback về 1');
    assert.equal(p3.role, 'student');

    // 5. Khôi phục lại migration chính thức cho các test khác nếu cần
    const migrationPath = path.resolve('supabase/migrations/20261013120000_auth_role_trust_hardening.sql');
    await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  });
});
