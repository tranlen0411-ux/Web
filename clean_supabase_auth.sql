-- ============================================================================
-- KỊCH BẢN SỬA TRIỆT ĐỂ LỖI AUTH SUPABASE (CLEANUP BAD INSTANCE_ID & RESTART)
-- ============================================================================

-- Step 1: DỌN SẠCH TẤT CẢ TÀI KHOẢN MẪU BỊ LỖI INSTANCE_ID TRONG BẢNG AUTH.USERS
DELETE FROM auth.users WHERE email LIKE '%@hoclapvui.edu.vn' OR email LIKE '%@student.hoclapvui.edu.vn';
DELETE FROM public.profiles WHERE email LIKE '%@hoclapvui.edu.vn' OR email LIKE '%@student.hoclapvui.edu.vn';

-- Step 2: DỌN SẠCH TRIGGER DƯ THỪA TRÊN BẢNG AUTH.USERS
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT trigger_name 
    FROM information_schema.triggers 
    WHERE event_object_schema = 'auth' AND event_object_table = 'users'
  ) LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || ' ON auth.users CASCADE;';
  END LOOP;
END $$;

-- Step 3: CẤP QUYỀN TRUY CẬP ĐẦY ĐỦ SCHEMA PUBLIC CHO SUPABASE GOTRUE AUTH
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres;

-- Step 4: TẮT RLS BẢNG PROFILES ĐỂ KHÔNG BỊ KHÓA POLICIES
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- Step 5: TẠO HÀM TRIGGER HANDLE_NEW_USER BẢO VỆ TỰ ĐỘNG NẠP PROFILE
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, avatar_url, grade_level)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
      COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/bottts/svg?seed=' || NEW.id),
      COALESCE((NEW.raw_user_meta_data->>'grade_level')::INT, 1)
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      role = COALESCE(EXCLUDED.role, public.profiles.role),
      updated_at = NOW();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
