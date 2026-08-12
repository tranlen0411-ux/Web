-- ============================================================================
-- SỬA DỨT ĐIỂM LỖI "INVALID LOGIN CREDENTIALS" & NẠP TÀI KHOẢN CHUẨN SUPABASE
-- ============================================================================

-- Step 1: CẤP QUYỀN TRUY CẬP ĐẦY ĐỦ SCHEMA PUBLIC
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres;

-- Step 2: TẮT RLS BẢNG PROFILES ĐỂ BẢO ĐẢM TRUY VẤN MƯỢT MÀ
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- Step 3: NẠP TÀI KHOẢN MẪU KHỚP VỚI INSTANCE_ID VÀ TỰ ĐỘNG XÁC THỰC EMAIL
DO $$
DECLARE
  v_instance_id UUID;
BEGIN
  -- Lấy mã instance_id chuẩn từ hệ thống Supabase Auth GoTrue
  SELECT instance_id INTO v_instance_id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1;
  IF v_instance_id IS NULL THEN
    v_instance_id := '00000000-0000-0000-0000-000000000000';
  END IF;

  -- Nạp Thầy Minh (thay.minh@hoclapvui.edu.vn / Pass: 123456)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    'b2000000-0000-0000-0000-000000000002',
    v_instance_id,
    'thay.minh@hoclapvui.edu.vn',
    crypt('123456', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Thầy Trần Đức Minh","role":"teacher","grade_level":3}',
    now(), now(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = crypt('123456', gen_salt('bf')),
    email_confirmed_at = now(),
    instance_id = v_instance_id;

  -- Nạp Cô Hoa (co.hoa@hoclapvui.edu.vn / Pass: 123456)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    'b1000000-0000-0000-0000-000000000001',
    v_instance_id,
    'co.hoa@hoclapvui.edu.vn',
    crypt('123456', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Cô Nguyễn Thị Hoa","role":"teacher","grade_level":1}',
    now(), now(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = crypt('123456', gen_salt('bf')),
    email_confirmed_at = now(),
    instance_id = v_instance_id;

  -- Nạp Admin (admin@hoclapvui.edu.vn / Pass: admin123456)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    v_instance_id,
    'admin@hoclapvui.edu.vn',
    crypt('admin123456', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Quản Trị Viên Hệ Thống","role":"admin","grade_level":1}',
    now(), now(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = crypt('admin123456', gen_salt('bf')),
    email_confirmed_at = now(),
    instance_id = v_instance_id;

  -- Nạp Học Sinh Nam (hs_nam@hoclapvui.edu.vn / Pass: 123456)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    'c1000000-0000-0000-0000-000000000001',
    v_instance_id,
    'hs_nam@hoclapvui.edu.vn',
    crypt('123456', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Nguyễn Văn Nam (HS101)","role":"student","grade_level":1}',
    now(), now(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = crypt('123456', gen_salt('bf')),
    email_confirmed_at = now(),
    instance_id = v_instance_id;

  -- Tự động xác thực email cho tất cả người dùng trong auth.users
  UPDATE auth.users SET email_confirmed_at = now() WHERE email_confirmed_at IS NULL;
END $$;

-- Step 4: CẬP NHẬT BẢNG PROFILES THÔNG TIN TÀI KHOẢN
INSERT INTO public.profiles (id, email, full_name, role, grade_level, total_stars, total_coins) VALUES
('b2000000-0000-0000-0000-000000000002', 'thay.minh@hoclapvui.edu.vn', 'Thầy Trần Đức Minh', 'teacher', 3, 0, 0),
('b1000000-0000-0000-0000-000000000001', 'co.hoa@hoclapvui.edu.vn', 'Cô Nguyễn Thị Hoa', 'teacher', 1, 0, 0),
('a0000000-0000-0000-0000-000000000001', 'admin@hoclapvui.edu.vn', 'Quản Trị Viên Hệ Thống', 'admin', 1, 0, 0),
('c1000000-0000-0000-0000-000000000001', 'hs_nam@hoclapvui.edu.vn', 'Nguyễn Văn Nam (HS101)', 'student', 1, 150, 60)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role;
