-- ============================================================================
-- KHO TRÒ CHƠI HỌC VUI TIỂU HỌC (KHỐI 1 - 5)
-- SUPABASE POSTGRESQL DATABASE MIGRATION SCRIPT
-- AUTH-01: Email/Password | AUTH-02: Google OAuth | AUTH-03: RLS 3 Cấp (Admin, Teacher, Student) | AUTH-04: Mã Phụ Huynh
-- ============================================================================

-- 1. BẢNG PROFILES (Hồ sơ người dùng)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student')),
  avatar_url TEXT DEFAULT 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu',
  grade_level INT DEFAULT 1 CHECK (grade_level BETWEEN 1 AND 5),
  total_stars INT DEFAULT 0,
  total_coins INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BẢNG CLASSES (Lớp học do giáo viên quản lý)
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade_level INT NOT NULL CHECK (grade_level BETWEEN 1 AND 5),
  code TEXT UNIQUE NOT NULL,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BẢNG CLASS_MEMBERS (Danh sách học sinh thuộc lớp)
CREATE TABLE IF NOT EXISTS public.class_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_class_student UNIQUE (class_id, student_id)
);

-- 4. BẢNG CATEGORIES (Danh mục Khối lớp và Môn học)
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('subject', 'grade')),
  icon_name TEXT NOT NULL DEFAULT 'BookOpen'
);

-- 5. BẢNG GAMES (Kho trò chơi học tập)
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  game_type TEXT NOT NULL CHECK (game_type IN ('iframe', 'html5_zip', 'builtin')),
  game_url TEXT NOT NULL,
  grade_level INT NOT NULL CHECK (grade_level BETWEEN 1 AND 5),
  subject TEXT NOT NULL,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT TRUE,
  play_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. BẢNG ASSIGNMENTS (Nhiệm vụ / Bài tập trò chơi được giao)
CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  reward_stars INT DEFAULT 10,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. BẢNG STUDENT_PROGRESS (Tiến độ & Nhật ký kết quả học sinh)
CREATE TABLE IF NOT EXISTS public.student_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  score INT DEFAULT 0,
  stars_earned INT DEFAULT 0,
  completion_time_seconds INT DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. BẢNG BADGES (Danh mục Huy hiệu thưởng)
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_url TEXT NOT NULL,
  required_stars INT DEFAULT 50,
  category TEXT DEFAULT 'general'
);

-- 9. BẢNG STUDENT_BADGES (Huy hiệu học sinh đạt được)
CREATE TABLE IF NOT EXISTS public.student_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_student_badge UNIQUE (student_id, badge_id)
);

-- CẤP QUYỀN TRUY CẬP CHO SCHEMA PUBLIC
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

-- HÀM LẤY VAI TRÒ DÙNG BẢO MẬT KHÔNG ĐỆ QUY (AUTH-03)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- BẬT ROW LEVEL SECURITY (RLS 3 CẤP)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_badges ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- AUTH-03: PHÂN QUYỀN RLS 3 CẤP (ADMIN, GIÁO VIÊN, HỌC SINH)
-- ============================================================================

-- PROFILES POLICIES
DROP POLICY IF EXISTS "Public profiles read" ON public.profiles;
DROP POLICY IF EXISTS "Users update own or admin update all" ON public.profiles;

CREATE POLICY "Public profiles read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own or admin update all" ON public.profiles FOR UPDATE USING (
  auth.uid() = id OR public.get_my_role() = 'admin'
);

-- CLASSES POLICIES (Giáo viên & Admin tạo lớp)
DROP POLICY IF EXISTS "Anyone read classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers and admins create classes" ON public.classes;

CREATE POLICY "Anyone read classes" ON public.classes FOR SELECT USING (true);
CREATE POLICY "Teachers and admins create classes" ON public.classes FOR INSERT WITH CHECK (
  public.get_my_role() IN ('teacher', 'admin')
);

-- GAMES POLICIES (Giáo viên & Admin thêm game)
DROP POLICY IF EXISTS "Anyone read games" ON public.games;
DROP POLICY IF EXISTS "Teachers and admins manage games" ON public.games;

CREATE POLICY "Anyone read games" ON public.games FOR SELECT USING (true);
CREATE POLICY "Teachers and admins manage games" ON public.games FOR ALL USING (
  public.get_my_role() IN ('teacher', 'admin')
);

-- ASSIGNMENTS POLICIES (Giáo viên & Admin giao bài)
DROP POLICY IF EXISTS "Anyone read assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teachers and admins create assignments" ON public.assignments;

CREATE POLICY "Anyone read assignments" ON public.assignments FOR SELECT USING (true);
CREATE POLICY "Teachers and admins create assignments" ON public.assignments FOR INSERT WITH CHECK (
  public.get_my_role() IN ('teacher', 'admin')
);

-- STUDENT_PROGRESS POLICIES (Học sinh lưu bài, Giáo viên/Admin xem)
DROP POLICY IF EXISTS "Read progress policy" ON public.student_progress;
DROP POLICY IF EXISTS "Student insert progress" ON public.student_progress;

CREATE POLICY "Read progress policy" ON public.student_progress FOR SELECT USING (true);
CREATE POLICY "Student insert progress" ON public.student_progress FOR INSERT WITH CHECK (
  student_id = auth.uid()
);

-- OTHER TABLES PUBLIC READ POLICIES
CREATE POLICY "Public categories read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public badges read" ON public.badges FOR SELECT USING (true);
CREATE POLICY "Public student badges read" ON public.student_badges FOR SELECT USING (true);
CREATE POLICY "Student insert badges" ON public.student_badges FOR INSERT WITH CHECK (student_id = auth.uid());

-- TRIGGER TỰ ĐỘNG KHỞI TẠO NGUYÊN THỂ AN TOÀN
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
