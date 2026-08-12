-- ============================================================================
-- KHO TRÒ CHƠI HỌC VUI TIỂU HỌC (KHỐI 1 - 5)
-- SUPABASE POSTGRESQL DATABASE MIGRATION SCRIPT (SCHEMA & RLS POLICIES)
-- ============================================================================

-- 1. BẢNG PROFILES (Hồ sơ người dùng)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student')),
  avatar_url TEXT DEFAULT 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu',
  grade_level INT CHECK (grade_level BETWEEN 1 AND 5),
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

-- ============================================================================
-- INDEXES CHO TỐI ƯU HÓA TRUY VẤN
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_games_grade_subject ON public.games (grade_level, subject);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON public.classes (teacher_id);
CREATE INDEX IF NOT EXISTS idx_class_members_student ON public.class_members (student_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_student ON public.student_progress (student_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_game ON public.student_progress (game_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON public.assignments (class_id);

-- ============================================================================
-- BẬT ROW LEVEL SECURITY (RLS) TRÊN TẤT CẢ CÁC BẢNG
-- ============================================================================
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
-- NGUYÊN TẮC PHÂN QUYỀN RLS POLICIES
-- ============================================================================

-- PROFILES
DROP POLICY IF EXISTS "Public profiles read" ON public.profiles;
CREATE POLICY "Public profiles read" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admin can manage all profiles" ON public.profiles;
CREATE POLICY "Admin can manage all profiles" ON public.profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- CLASSES
DROP POLICY IF EXISTS "Anyone read classes" ON public.classes;
CREATE POLICY "Anyone read classes" ON public.classes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Teachers create classes" ON public.classes;
CREATE POLICY "Teachers create classes" ON public.classes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
);

DROP POLICY IF EXISTS "Teacher update own classes" ON public.classes;
CREATE POLICY "Teacher update own classes" ON public.classes FOR UPDATE USING (
  teacher_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- CLASS_MEMBERS
DROP POLICY IF EXISTS "Anyone read class members" ON public.class_members;
CREATE POLICY "Anyone read class members" ON public.class_members FOR SELECT USING (true);

DROP POLICY IF EXISTS "Students or teachers add class members" ON public.class_members;
CREATE POLICY "Students or teachers add class members" ON public.class_members FOR INSERT WITH CHECK (
  auth.uid() = student_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
);

-- CATEGORIES
DROP POLICY IF EXISTS "Anyone read categories" ON public.categories;
CREATE POLICY "Anyone read categories" ON public.categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin manage categories" ON public.categories;
CREATE POLICY "Admin manage categories" ON public.categories FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- GAMES
DROP POLICY IF EXISTS "Anyone read public games" ON public.games;
CREATE POLICY "Anyone read public games" ON public.games FOR SELECT USING (is_public = true OR author_id = auth.uid());

DROP POLICY IF EXISTS "Teachers and admins insert games" ON public.games;
CREATE POLICY "Teachers and admins insert games" ON public.games FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
);

DROP POLICY IF EXISTS "Author or Admin update games" ON public.games;
CREATE POLICY "Author or Admin update games" ON public.games FOR UPDATE USING (
  author_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ASSIGNMENTS
DROP POLICY IF EXISTS "Anyone read assignments" ON public.assignments;
CREATE POLICY "Anyone read assignments" ON public.assignments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Teachers create assignments" ON public.assignments;
CREATE POLICY "Teachers create assignments" ON public.assignments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
);

-- STUDENT_PROGRESS
DROP POLICY IF EXISTS "Anyone read progress" ON public.student_progress;
CREATE POLICY "Anyone read progress" ON public.student_progress FOR SELECT USING (true);

DROP POLICY IF EXISTS "Students insert own progress" ON public.student_progress;
CREATE POLICY "Students insert own progress" ON public.student_progress FOR INSERT WITH CHECK (
  student_id = auth.uid()
);

-- BADGES
DROP POLICY IF EXISTS "Anyone read badges" ON public.badges;
CREATE POLICY "Anyone read badges" ON public.badges FOR SELECT USING (true);

-- STUDENT_BADGES
DROP POLICY IF EXISTS "Anyone read student badges" ON public.student_badges;
CREATE POLICY "Anyone read student badges" ON public.student_badges FOR SELECT USING (true);

DROP POLICY IF EXISTS "Students insert own badges" ON public.student_badges;
CREATE POLICY "Students insert own badges" ON public.student_badges FOR INSERT WITH CHECK (
  student_id = auth.uid()
);

-- ============================================================================
-- TRIGGER TỰ ĐỘNG KHỞI TẠO PROFILES KHI ĐĂNG KÝ
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, avatar_url, grade_level)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/bottts/svg?seed=' || NEW.id),
    COALESCE((NEW.raw_user_meta_data->>'grade_level')::INT, 1)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- SEED DATA INITIALIZATION (DỮ LIỆU BAN ĐẦU CHUẨN GDPT)
-- ============================================================================

-- Danh mục Môn học & Khối
INSERT INTO public.categories (name, type, icon_name) VALUES
('Toán', 'subject', 'Calculator'),
('Tiếng Việt', 'subject', 'BookOpen'),
('Tiếng Anh', 'subject', 'Languages'),
('Tự nhiên & Xã hội', 'subject', 'Trees'),
('Lịch sử & Địa lý', 'subject', 'Globe'),
('Tin học', 'subject', 'Laptop'),
('Lớp 1', 'grade', 'GraduationCap'),
('Lớp 2', 'grade', 'GraduationCap'),
('Lớp 3', 'grade', 'GraduationCap'),
('Lớp 4', 'grade', 'GraduationCap'),
('Lớp 5', 'grade', 'GraduationCap')
ON CONFLICT DO NOTHING;

-- Danh mục Huy hiệu
INSERT INTO public.badges (title, description, icon_url, required_stars, category) VALUES
('Thần Đồng Toán Học', 'Đạt 50 Sao từ các trò chơi Toán học', '🌟', 50, 'Toán'),
('Vua Tiếng Việt', 'Hoàn thành 5 bài luyện từ và câu', '📚', 40, 'Tiếng Việt'),
('Hiệp Sĩ Tiếng Anh', 'Ghép đúng 50 cặp từ vựng Tiếng Anh', '🇬🇧', 60, 'Tiếng Anh'),
('Bậc Thầy Lật Thẻ', 'Hoàn thành Game lật thẻ dưới 30 giây', '🃏', 30, 'Game'),
('Nhà Đua Trắc Nghiệm', 'Trả lời đúng liên tiếp 10 câu trắc nghiệm', '🏎️', 50, 'Game'),
('Ong Chăm Chỉ', 'Đăng nhập và tích lũy tổng cộng 100 Sao', '🐝', 100, 'Hệ thống')
ON CONFLICT DO NOTHING;

-- Kho Game Học Tập Mẫu (Built-in & Embed)
INSERT INTO public.games (id, title, description, thumbnail_url, game_type, game_url, grade_level, subject, is_public, play_count) VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'Thử Thách Lật Thẻ Toán Học & Từ Vựng',
  'Trò chơi lật thẻ ghi nhớ giúp bé rèn luyện trí nhớ, ghép cặp phép tính và từ vựng Tiếng Anh sinh động.',
  'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60',
  'builtin',
  'memory-game',
  1,
  'Toán',
  true,
  128
),
(
  '22222222-2222-2222-2222-222222222222',
  'Đua Xe Trắc Nghiệm Tri Thức Tiểu Học',
  'Cuộc đua xe trắc nghiệm tốc độ! Trả lời đúng các câu hỏi Toán và Tiếng Việt để xe đua bứt phá về đích.',
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=500&auto=format&fit=crop&q=60',
  'builtin',
  'quiz-race',
  2,
  'Tiếng Việt',
  true,
  256
),
(
  '33333333-3333-3333-3333-333333333333',
  'Ô Chữ Tiếng Anh Tiểu Học (Wordwall Embed)',
  'Trò chơi nối từ và ô chữ tiếng Anh rèn luyện kỹ năng từ vựng tiểu học sinh động.',
  'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=500&auto=format&fit=crop&q=60',
  'iframe',
  'https://wordwall.net/embed/4f6d4d1e2e924a66a1a4c9c22822a101',
  3,
  'Tiếng Anh',
  true,
  95
),
(
  '44444444-4444-4444-4444-444444444444',
  'Khám Phá Thế Giới Động Vật & Tự Nhiên',
  'Trắc nghiệm hình ảnh trực quan giúp bé nhận biết thế giới tự nhiên và bảo vệ môi trường.',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&auto=format&fit=crop&q=60',
  'iframe',
  'https://quizizz.com/embed/quiz/609a1f2b3e45f9001b9d4e5f',
  4,
  'Tự nhiên & Xã hội',
  true,
  76
)
ON CONFLICT (id) DO NOTHING;

