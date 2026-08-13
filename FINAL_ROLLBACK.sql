BEGIN;

-- 1. KHÔI PHỤC CHÍNH XÁC QUYỀN BẢNG THỰC TẾ TRƯỚC MIGRATION
GRANT INSERT, UPDATE, DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.profiles TO anon;
GRANT ALL PRIVILEGES ON public.profiles TO authenticated;

-- 2. KHÔI PHỤC PHIÊN BẢN HÀM NGUYÊN BẢN HANDLE_NEW_USER VÀ TRIGGER SIGNUP
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

-- 3. KHÔI PHỤC POLICY BAN ĐẦU
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "Public profiles read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own or admin update all" ON public.profiles FOR UPDATE USING (
  auth.uid() = id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

DROP POLICY IF EXISTS "classes_select" ON public.classes;
DROP POLICY IF EXISTS "classes_insert" ON public.classes;
DROP POLICY IF EXISTS "classes_update" ON public.classes;
DROP POLICY IF EXISTS "classes_delete" ON public.classes;
CREATE POLICY "Anyone read classes" ON public.classes FOR SELECT USING (true);
CREATE POLICY "Teachers and admins create classes" ON public.classes FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('teacher', 'admin')
);

DROP POLICY IF EXISTS "class_members_select" ON public.class_members;
DROP POLICY IF EXISTS "class_members_insert" ON public.class_members;
DROP POLICY IF EXISTS "class_members_delete" ON public.class_members;
CREATE POLICY "Anyone read class members" ON public.class_members FOR SELECT USING (true);

DROP POLICY IF EXISTS "games_select" ON public.games;
DROP POLICY IF EXISTS "games_manage" ON public.games;
DROP POLICY IF EXISTS "games_insert" ON public.games;
DROP POLICY IF EXISTS "games_update" ON public.games;
DROP POLICY IF EXISTS "games_delete" ON public.games;
CREATE POLICY "Anyone read games" ON public.games FOR SELECT USING (true);
CREATE POLICY "Teachers and admins manage games" ON public.games FOR ALL USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('teacher', 'admin')
);

DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
DROP POLICY IF EXISTS "assignments_insert" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete" ON public.assignments;
CREATE POLICY "Anyone read assignments" ON public.assignments FOR SELECT USING (true);
CREATE POLICY "Teachers and admins create assignments" ON public.assignments FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('teacher', 'admin')
);

DROP POLICY IF EXISTS "progress_select" ON public.student_progress;
DROP POLICY IF EXISTS "progress_insert" ON public.student_progress;
DROP POLICY IF EXISTS "progress_update" ON public.student_progress;
CREATE POLICY "Read progress policy" ON public.student_progress FOR SELECT USING (true);
CREATE POLICY "Student insert progress" ON public.student_progress FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "student_badges_select" ON public.student_badges;
DROP POLICY IF EXISTS "student_badges_insert" ON public.student_badges;
CREATE POLICY "Public student badges read" ON public.student_badges FOR SELECT USING (true);
CREATE POLICY "Student insert badges" ON public.student_badges FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "categories_select" ON public.categories;
DROP POLICY IF EXISTS "badges_select" ON public.badges;
CREATE POLICY "Public categories read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public badges read" ON public.badges FOR SELECT USING (true);

-- 4. TẮT RLS BAN ĐẦU
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_progress DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_badges DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.games DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges DISABLE ROW LEVEL SECURITY;

-- 5. DROP HÀM, RPC VÀ SCHEMA
DROP TRIGGER IF EXISTS trg_prevent_profile_tampering ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_profile_tampering();
DROP FUNCTION IF EXISTS public.admin_update_profile(UUID, TEXT, INT, INT, INT);
DROP FUNCTION IF EXISTS public.complete_game_and_award(UUID, UUID, INT, INT);
DROP FUNCTION IF EXISTS public.join_class_by_code(TEXT);
DROP INDEX IF EXISTS public.uq_student_assignment_progress;
DROP SCHEMA IF EXISTS app_private CASCADE;

COMMIT;
