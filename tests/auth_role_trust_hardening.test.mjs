import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

describe('P0 AUTH ROLE TRUST HARDENING AUDIT & TEST SUITE', () => {
  let db;

  before(async () => {
    db = new PGlite();

    // 1. Tạo mock schema auth và public
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

    // Xác nhận đã có role = teacher
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
    // 1. Tạo tài khoản thường
    const res = await db.query(`
      INSERT INTO auth.users (email, raw_user_meta_data)
      VALUES ('promoted_user@test.local', '{"full_name": "Người Dùng Thăng Chức"}'::jsonb)
      RETURNING id;
    `);
    const userId = res.rows[0].id;

    // 2. Xác nhận ban đầu là student
    const initRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(initRes.rows[0].role, 'student');

    // 3. Admin thực hiện thăng quyền qua Admin RPC / Service Role
    await db.query(`
      UPDATE public.profiles
      SET role = 'teacher', updated_at = now()
      WHERE id = $1;
    `, [userId]);

    // 4. Xác nhận đã thăng quyền thành công
    const updatedRes = await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [userId]);
    assert.equal(updatedRes.rows[0].role, 'teacher', 'Admin có thể thăng quyền giáo viên an toàn qua luồng quản trị');
  });
});
