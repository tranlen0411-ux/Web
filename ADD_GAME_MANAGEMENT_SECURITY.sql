-- ============================================================================
-- MIGRATION AN TOÀN: SIẾT CHẶT BẢO MẬT GAMES, ASSIGNMENTS VÀ STORAGE GAME-THUMBNAILS
-- BẢO TOÀN 100% DỮ LIỆU VÀ LỊCH SỬ HỌC SINH (HỦY MỀM & THAY THẾ AN TOÀN)
-- ============================================================================

BEGIN;

-- 1. BỔ SUNG CÁC CỘT MỚI CHO PUBLIC.ASSIGNMENTS (DÙNG ADD COLUMN IF NOT EXISTS)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'cancelled'));
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES public.assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.assignments(status);
CREATE INDEX IF NOT EXISTS idx_assignments_class_status ON public.assignments(class_id, status);

-- ĐẢM BẢO TẤT CẢ BÀI GIAO HIỆN CÓ LÀ ACTIVE
UPDATE public.assignments SET status = 'active' WHERE status IS NULL;

-- 2. ĐẢM BẢO CỘT AUTHOR_ID VÀ CHỈ MỤC CHO PUBLIC.GAMES
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_games_author_id ON public.games(author_id);

-- 3. TẠO BUCKET STORAGE 'game-thumbnails' (PUBLIC BUCKET DÀNH CHO ẢNH TRÒ CHƠI)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'game-thumbnails',
  'game-thumbnails',
  true,
  5242880, -- Giới hạn 5MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] -- Cấm tuyệt đối SVG
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- 4. SIẾT CHẶT POLICIES CHO PUBLIC.GAMES
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone read games" ON public.games;
DROP POLICY IF EXISTS "Teachers and admins manage games" ON public.games;
DROP POLICY IF EXISTS "Admin full control games" ON public.games;
DROP POLICY IF EXISTS "Teacher update own games" ON public.games;
DROP POLICY IF EXISTS "Teacher delete own games" ON public.games;
DROP POLICY IF EXISTS "Teachers and admins insert games" ON public.games;
DROP POLICY IF EXISTS "Teacher and admin update games" ON public.games;
DROP POLICY IF EXISTS "Teacher and admin delete games" ON public.games;
DROP POLICY IF EXISTS "Games select policy" ON public.games;
DROP POLICY IF EXISTS "Games insert policy" ON public.games;
DROP POLICY IF EXISTS "Games update policy" ON public.games;
DROP POLICY IF EXISTS "Games delete policy" ON public.games;

-- SELECT: Ai cũng đọc được danh sách trò chơi công khai
CREATE POLICY "Games select policy" ON public.games FOR SELECT USING (true);

-- INSERT: Giáo viên chỉ tạo game có author_id = auth.uid(); Admin có thể tạo game chung
CREATE POLICY "Games insert policy" ON public.games FOR INSERT WITH CHECK (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
);

-- UPDATE: Admin sửa tất cả. Giáo viên CHỈ sửa game có author_id = auth.uid() VÀ sau khi sửa author_id vẫn là auth.uid()
CREATE POLICY "Games update policy" ON public.games FOR UPDATE
USING (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
)
WITH CHECK (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
);

-- DELETE: Admin xóa tất cả. Giáo viên CHỈ xóa game do chính mình tạo (author_id = auth.uid())
CREATE POLICY "Games delete policy" ON public.games FOR DELETE USING (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
);

-- 5. SIẾT CHẶT AN TOÀN POLICIES CHO PUBLIC.ASSIGNMENTS
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone read assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teachers and admins create assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teacher manage own class assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teacher and admin insert assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teacher and admin update assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teacher and admin delete assignments" ON public.assignments;
DROP POLICY IF EXISTS "Assignments select policy" ON public.assignments;
DROP POLICY IF EXISTS "Assignments insert policy" ON public.assignments;
DROP POLICY IF EXISTS "Assignments update policy" ON public.assignments;
DROP POLICY IF EXISTS "Assignments delete policy" ON public.assignments;

-- SELECT: Admin đọc tất cả, Giáo viên đọc bài giao của lớp mình, Học sinh đọc bài giao của lớp mình
CREATE POLICY "Assignments select policy" ON public.assignments FOR SELECT USING (
  app_private.is_admin()
  OR app_private.teacher_owns_class(class_id)
  OR app_private.student_in_class(class_id)
);

-- INSERT: Admin hoặc Giáo viên sở hữu lớp
CREATE POLICY "Assignments insert policy" ON public.assignments FOR INSERT WITH CHECK (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

-- UPDATE: Admin hoặc Giáo viên sở hữu lớp (có cả USING và WITH CHECK để chống đổi class_id sang lớp khác)
CREATE POLICY "Assignments update policy" ON public.assignments FOR UPDATE
USING (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
)
WITH CHECK (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

-- DELETE: Admin hoặc Giáo viên sở hữu lớp
CREATE POLICY "Assignments delete policy" ON public.assignments FOR DELETE USING (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

-- 6. SIẾT CHẶT AN TOÀN STORAGE POLICIES CHO BUCKET 'game-thumbnails' ({auth.uid()}/{filename})
DROP POLICY IF EXISTS "Public read game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated insert game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails select policy" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails update policy" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails delete policy" ON storage.objects;

-- SELECT: Public/anon đọc ảnh đại diện
CREATE POLICY "Game thumbnails select policy" ON storage.objects
  FOR SELECT USING (bucket_id = 'game-thumbnails');

-- INSERT: Admin tải mọi thư mục. Giáo viên CHỈ được tải vào thư mục mang UUID của chính mình ({auth.uid()}/filename)
CREATE POLICY "Game thumbnails insert policy" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'game-thumbnails'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      app_private.is_admin()
      OR (app_private.is_teacher() AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    )
  );

-- UPDATE: Admin hoặc Giáo viên sửa file trong thư mục của chính mình
CREATE POLICY "Game thumbnails update policy" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'game-thumbnails'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      app_private.is_admin()
      OR (app_private.is_teacher() AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    )
  );

-- DELETE: Admin hoặc Giáo viên xóa file trong thư mục của chính mình
CREATE POLICY "Game thumbnails delete policy" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'game-thumbnails'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      app_private.is_admin()
      OR (app_private.is_teacher() AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    )
  );

-- 7. RPC THAY TRÒ CHƠI ĐÃ GIAO AN TOÀN TRONG NỘI BỘ NGUYÊN TỬ TRANSACTION
CREATE OR REPLACE FUNCTION public.replace_assignment_safely(
  p_assignment_id UUID,
  p_new_game_id UUID,
  p_reward_stars INT DEFAULT 10,
  p_due_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_assign RECORD;
  v_progress_count INT;
  v_new_assignment_id UUID;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  -- Khóa bản ghi assignment hiện tại để tránh thao tác đồng thời
  SELECT id, class_id, game_id, status INTO v_assign
  FROM public.assignments
  WHERE id = p_assignment_id FOR UPDATE;

  IF v_assign.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài không tồn tại.');
  END IF;

  IF v_assign.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài này không ở trạng thái hoạt động.');
  END IF;

  -- Kiểm tra quyền sở hữu lớp hoặc Admin
  IF NOT (app_private.is_admin() OR app_private.teacher_owns_class(v_assign.class_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Thầy/Cô không quản lý lớp học này.');
  END IF;

  -- Kiểm tra trò chơi mới có tồn tại không
  IF NOT EXISTS (SELECT 1 FROM public.games WHERE id = p_new_game_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trò chơi mới chọn không tồn tại.');
  END IF;

  -- Đếm số lượt tiến độ làm bài cũ của học sinh
  SELECT COUNT(*) INTO v_progress_count
  FROM public.student_progress
  WHERE assignment_id = p_assignment_id;

  IF v_progress_count > 0 THEN
    -- ĐÃ CÓ TIẾN ĐỘ: Không sửa game_id cũ để bảo toàn 100% lịch sử.
    -- 1. Tạo bài giao mới cho trò chơi mới
    INSERT INTO public.assignments (game_id, class_id, reward_stars, due_date, status)
    VALUES (p_new_game_id, v_assign.class_id, GREATEST(1, p_reward_stars), p_due_date, 'active')
    RETURNING id INTO v_new_assignment_id;

    -- 2. Chuyển bài giao cũ sang trạng thái 'archived' và lưu vết replaced_by
    UPDATE public.assignments
    SET status = 'archived',
        archived_at = NOW(),
        replaced_by = v_new_assignment_id
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'success', true, 
      'message', 'Đã lưu trữ bài giao cũ và tạo bài giao mới thành công. Lịch sử bài làm của học sinh được bảo toàn 100%.',
      'action', 'archived_and_created_new',
      'new_assignment_id', v_new_assignment_id
    );
  ELSE
    -- CHƯA CÓ TIẾN ĐỘ: Cập nhật trực tiếp lượt giao bài hiện tại
    UPDATE public.assignments
    SET game_id = p_new_game_id,
        reward_stars = GREATEST(1, p_reward_stars),
        due_date = p_due_date,
        status = 'active'
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'success', true, 
      'message', 'Cập nhật bài giao thành công.',
      'action', 'updated_existing'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_assignment_safely(UUID, UUID, INT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_assignment_safely(UUID, UUID, INT, TIMESTAMPTZ) TO authenticated;

-- 8. RPC HỦY MỀM BÀI GIAO AN TOÀN TRONG CSDL (CANCEL ASSIGNMENT SAFELY)
CREATE OR REPLACE FUNCTION public.cancel_assignment_safely(p_assignment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_assign RECORD;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT id, class_id, status INTO v_assign
  FROM public.assignments
  WHERE id = p_assignment_id FOR UPDATE;

  IF v_assign.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài không tồn tại.');
  END IF;

  IF NOT (app_private.is_admin() OR app_private.teacher_owns_class(v_assign.class_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Thầy/Cô không quản lý lớp học này.');
  END IF;

  UPDATE public.assignments
  SET status = 'cancelled',
      archived_at = NOW()
  WHERE id = p_assignment_id;

  RETURN jsonb_build_object('success', true, 'message', 'Đã hủy lượt giao bài thành công. Lịch sử làm bài cũ vẫn được giữ nguyên.');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_assignment_safely(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_assignment_safely(UUID) TO authenticated;

COMMIT;
