-- ============================================================================
-- MIGRATION: BỔ SUNG AN TOÀN CHO BẢNG GAMES, BÀI TẬP VÀ BUCKET ẢNH GAME_THUMBNAILS
-- ============================================================================

BEGIN;

-- 1. ĐẢM BẢO CỘT AUTHOR_ID TRONG PUBLIC.GAMES CÓ KHÓA NGOẠI VÀ CHỈ MỤC
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_games_author_id ON public.games(author_id);

-- 2. TẠO BUCKET STORAGE 'game-thumbnails' NẾU CHƯA TỒN TẠI (PUBLIC BUCKET DÀNH CHO ẢNH TRÒ CHƠI)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'game-thumbnails',
  'game-thumbnails',
  true,
  5242880, -- Giới hạn 5MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] -- Tuyệt đối không cho phép SVG
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- 3. CẬP NHẬT RLS CHO PUBLIC.GAMES (ADMIN SỬA TẤT CẢ, GIÁO VIÊN SỬA GAME DO MÌNH TẠO)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone read games" ON public.games;
DROP POLICY IF EXISTS "Teachers and admins manage games" ON public.games;
DROP POLICY IF EXISTS "Admin full control games" ON public.games;
DROP POLICY IF EXISTS "Teacher update own games" ON public.games;
DROP POLICY IF EXISTS "Teacher delete own games" ON public.games;
DROP POLICY IF EXISTS "Teachers and admins insert games" ON public.games;

-- AI CŨNG CÓ THỂ ĐỌC DANH SÁCH GAME CÔNG KHAI HOẶC GAME DO CHÍNH MÌNH TẠO
CREATE POLICY "Anyone read games" ON public.games FOR SELECT USING (true);

-- ADMIN HOẶC GIÁO VIÊN CÓ THỂ THÊM GAME MỚI
CREATE POLICY "Teachers and admins insert games" ON public.games FOR INSERT WITH CHECK (
  public.get_my_role() IN ('admin', 'teacher')
);

-- ADMIN ĐƯỢC SỬA TẤT CẢ GAME, GIÁO VIÊN CHỈ ĐƯỢC SỬA GAME DO CHÍNH MÌNH TẠO (author_id = auth.uid())
CREATE POLICY "Teacher and admin update games" ON public.games FOR UPDATE USING (
  public.get_my_role() = 'admin' OR (
    public.get_my_role() = 'teacher' AND author_id = (SELECT auth.uid())
  )
);

-- ADMIN ĐƯỢC XÓA TẤT CẢ GAME, GIÁO VIÊN CHỈ ĐƯỢC XÓA GAME DO CHÍNH MÌNH TẠO
CREATE POLICY "Teacher and admin delete games" ON public.games FOR DELETE USING (
  public.get_my_role() = 'admin' OR (
    public.get_my_role() = 'teacher' AND author_id = (SELECT auth.uid())
  )
);

-- 4. CẬP NHẬT RLS CHO PUBLIC.ASSIGNMENTS (CHỈ ADMIN HOẶC GIÁO VIÊN SỞ HỮU LỚP MỚI ĐƯỢC THAO TÁC)
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone read assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teachers and admins create assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teacher manage own class assignments" ON public.assignments;

CREATE POLICY "Anyone read assignments" ON public.assignments FOR SELECT USING (true);

CREATE POLICY "Teacher and admin insert assignments" ON public.assignments FOR INSERT WITH CHECK (
  public.get_my_role() = 'admin' OR app_private.teacher_owns_class(class_id)
);

CREATE POLICY "Teacher and admin update assignments" ON public.assignments FOR UPDATE USING (
  public.get_my_role() = 'admin' OR app_private.teacher_owns_class(class_id)
);

CREATE POLICY "Teacher and admin delete assignments" ON public.assignments FOR DELETE USING (
  public.get_my_role() = 'admin' OR app_private.teacher_owns_class(class_id)
);

-- 5. RLS POLICIES CHO STORAGE BUCKET 'game-thumbnails'
DROP POLICY IF EXISTS "Public read game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated insert game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete game-thumbnails" ON storage.objects;

CREATE POLICY "Public read game-thumbnails" ON storage.objects
  FOR SELECT USING (bucket_id = 'game-thumbnails');

CREATE POLICY "Authenticated insert game-thumbnails" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'game-thumbnails' AND (SELECT auth.uid()) IS NOT NULL AND public.get_my_role() IN ('admin', 'teacher')
  );

CREATE POLICY "Authenticated update game-thumbnails" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'game-thumbnails' AND (SELECT auth.uid()) IS NOT NULL AND public.get_my_role() IN ('admin', 'teacher')
  );

CREATE POLICY "Authenticated delete game-thumbnails" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'game-thumbnails' AND (SELECT auth.uid()) IS NOT NULL AND public.get_my_role() IN ('admin', 'teacher')
  );

COMMIT;
