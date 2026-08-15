-- ============================================================================
-- MIGRATION AN TOÀN VIỆN TOÀN: SIẾT CHẶT BẢO MẬT GAMES, ASSIGNMENTS VÀ STORAGE GAME-THUMBNAILS
-- BẢO TOÀN 100% DỮ LIỆU VÀ LỊCH SỬ HỌC SINH (CHẶN HOÀN TOÀN DELETE TRỰC TIẾP, GIAO DỊCH 3 TRƯỜNG HỢP)
-- ============================================================================

BEGIN;

-- 1. BỔ SUNG CÁC CỘT MỚI CHO PUBLIC.ASSIGNMENTS (DÙNG ADD COLUMN IF NOT EXISTS)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'cancelled'));
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES public.assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.assignments(status);
CREATE INDEX IF NOT EXISTS idx_assignments_class_status ON public.assignments(class_id, status);

-- CHỈ CẬP NHẬT TRẠNG THÁI ACTIVE CHO BẢN GHI CÓ STATUS LÀ NULL (BẢO TOÀN GIÁ TRỊ CŨ)
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

-- ============================================================================
-- 4. XÓA SẠCH DƯ THỪA TẤT CẢ POLICY CỦ TRÊN PUBLIC.GAMES
-- ============================================================================
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
DROP POLICY IF EXISTS "games_select" ON public.games;
DROP POLICY IF EXISTS "games_insert" ON public.games;
DROP POLICY IF EXISTS "games_update" ON public.games;
DROP POLICY IF EXISTS "games_delete" ON public.games;
DROP POLICY IF EXISTS "Games_Select_Policy" ON public.games;
DROP POLICY IF EXISTS "Games_Insert_Policy" ON public.games;
DROP POLICY IF EXISTS "Games_Update_Policy" ON public.games;
DROP POLICY IF EXISTS "Games_Delete_Policy" ON public.games;

-- TẠO CHÍNH XÁC CÁC POLICY CUỐI CÙNG CHO PUBLIC.GAMES (CHẶN HOÀN TOÀN DELETE TRỰC TIẾP)
CREATE POLICY "Games_Select_Policy" ON public.games FOR SELECT USING (true);

CREATE POLICY "Games_Insert_Policy" ON public.games FOR INSERT WITH CHECK (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
);

CREATE POLICY "Games_Update_Policy" ON public.games FOR UPDATE
USING (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
)
WITH CHECK (
  app_private.is_admin()
  OR (app_private.is_teacher() AND author_id = (SELECT auth.uid()))
);

-- KHÔNG TẠO LẠI BẤT KỲ POLICY DELETE NÀO TRÊN PUBLIC.GAMES! (XÓA CHỈ QUA RPC ADMIN DELETE_GAME_SAFELY CHO GAME CHƯA DÙNG)

-- ============================================================================
-- 5. XÓA SẠCH DƯ THỪA TẤT CẢ POLICY CỦ TRÊN PUBLIC.ASSIGNMENTS
-- ============================================================================
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
DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
DROP POLICY IF EXISTS "assignments_insert" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete" ON public.assignments;
DROP POLICY IF EXISTS "Assignments_Select_Policy" ON public.assignments;
DROP POLICY IF EXISTS "Assignments_Insert_Policy" ON public.assignments;
DROP POLICY IF EXISTS "Assignments_Update_Policy" ON public.assignments;
DROP POLICY IF EXISTS "Assignments_Delete_Policy" ON public.assignments;

-- TẠO CHÍNH XÁC CÁC POLICY CUỐI CÙNG CHO PUBLIC.ASSIGNMENTS (CHẶN HOÀN TOÀN DELETE TRỰC TIẾP)
CREATE POLICY "Assignments_Select_Policy" ON public.assignments FOR SELECT USING (
  app_private.is_admin()
  OR app_private.teacher_owns_class(class_id)
  OR app_private.student_in_class(class_id)
);

CREATE POLICY "Assignments_Insert_Policy" ON public.assignments FOR INSERT WITH CHECK (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

CREATE POLICY "Assignments_Update_Policy" ON public.assignments FOR UPDATE
USING (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
)
WITH CHECK (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

-- KHÔNG TẠO LẠI BẤT KỲ POLICY DELETE NÀO TRÊN PUBLIC.ASSIGNMENTS! (HỦY BÀI CHỈ QUA RPC CANCEL_ASSIGNMENT_SAFELY)

-- ============================================================================
-- 6. XÓA SẠCH DƯ THỪA POLICY VÀ SIẾT CHẶT STORAGE POLICIES CHO 'game-thumbnails'
-- ============================================================================
DROP POLICY IF EXISTS "Public read game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated insert game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete game-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails select policy" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails update policy" ON storage.objects;
DROP POLICY IF EXISTS "Game thumbnails delete policy" ON storage.objects;
DROP POLICY IF EXISTS "game_thumbnails_select" ON storage.objects;
DROP POLICY IF EXISTS "game_thumbnails_insert" ON storage.objects;
DROP POLICY IF EXISTS "game_thumbnails_update" ON storage.objects;
DROP POLICY IF EXISTS "game_thumbnails_delete" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnails_Select_Policy" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnails_Insert_Policy" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnails_Update_Policy" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnails_Delete_Policy" ON storage.objects;

CREATE POLICY "Thumbnails_Select_Policy" ON storage.objects
  FOR SELECT USING (bucket_id = 'game-thumbnails');

CREATE POLICY "Thumbnails_Insert_Policy" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'game-thumbnails'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      app_private.is_admin()
      OR (app_private.is_teacher() AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    )
  );

CREATE POLICY "Thumbnails_Update_Policy" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'game-thumbnails'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      app_private.is_admin()
      OR (app_private.is_teacher() AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    )
  );

CREATE POLICY "Thumbnails_Delete_Policy" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'game-thumbnails'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      app_private.is_admin()
      OR (app_private.is_teacher() AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    )
  );

-- ============================================================================
-- 7. RPC THAY TRÒ CHƠI ĐÃ GIAO NGUYÊN TỬ VỚI 3 TRƯỜNG HỢP VÀ GIỚI HẠN ĐẦU VÀO STICK
-- ============================================================================
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
  -- 1. Kiểm tra xác thực người gọi
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  -- 2. Kiểm tra tham số bắt buộc không null
  IF p_assignment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mã lượt giao bài (p_assignment_id) không được để trống.');
  END IF;

  IF p_new_game_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mã trò chơi mới (p_new_game_id) không được để trống.');
  END IF;

  -- 3. Kiểm tra số sao thưởng nghiêm ngặt trong khoảng từ 1 đến 100
  IF p_reward_stars IS NULL OR p_reward_stars < 1 OR p_reward_stars > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Số sao thưởng phải nằm trong khoảng từ 1 đến 100 sao.');
  END IF;

  -- 4. Khóa bản ghi assignment hiện tại bằng FOR UPDATE để tránh race condition
  SELECT id, class_id, game_id, status INTO v_assign
  FROM public.assignments
  WHERE id = p_assignment_id FOR UPDATE;

  IF v_assign.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài không tồn tại.');
  END IF;

  -- 5. Chỉ cho phép thao tác trên bài giao đang ở trạng thái 'active'
  IF v_assign.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài này không ở trạng thái hoạt động (đã lưu trữ hoặc đã hủy).');
  END IF;

  -- 6. Kiểm tra quyền sở hữu lớp hoặc Admin
  IF NOT (app_private.is_admin() OR app_private.teacher_owns_class(v_assign.class_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Thầy/Cô không quản lý lớp học này.');
  END IF;

  -- 7. Kiểm tra trò chơi mới chọn có tồn tại không
  IF NOT EXISTS (SELECT 1 FROM public.games WHERE id = p_new_game_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trò chơi mới chọn không tồn tại.');
  END IF;

  -- =========================================================================
  -- XỬ LÝ 3 TRƯỜNG HỢP LOGIC NGUYÊN TỬ CHUẨN XÁC:
  -- =========================================================================

  -- TRƯỜNG HỢP A: KHÔNG ĐỔI TRÒ CHƠI (p_new_game_id = v_assign.game_id)
  IF p_new_game_id = v_assign.game_id THEN
    UPDATE public.assignments
    SET reward_stars = p_reward_stars,
        due_date = p_due_date
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'updated_metadata_only',
      'message', 'Đã cập nhật sao thưởng và hạn hoàn thành cho bài giao.'
    );
  END IF;

  -- Đếm số lượt học sinh đã làm bài
  SELECT COUNT(*) INTO v_progress_count
  FROM public.student_progress
  WHERE assignment_id = p_assignment_id;

  -- TRƯỜNG HỢP B: ĐỔI TRÒ CHƠI VÀ CHƯA CÓ TIẾN ĐỘ HỌC SINH (v_progress_count = 0)
  IF v_progress_count = 0 THEN
    UPDATE public.assignments
    SET game_id = p_new_game_id,
        reward_stars = p_reward_stars,
        due_date = p_due_date,
        status = 'active'
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'updated_existing',
      'message', 'Đã cập nhật trò chơi mới cho bài giao.'
    );
  END IF;

  -- TRƯỜNG HỢP C: ĐỔI TRÒ CHƠI VÀ ĐÃ CÓ TIẾN ĐỘ HỌC SINH (v_progress_count > 0)
  -- 1. Tạo bài giao mới ở trạng thái 'active' với trò chơi mới
  INSERT INTO public.assignments (game_id, class_id, reward_stars, due_date, status)
  VALUES (p_new_game_id, v_assign.class_id, p_reward_stars, p_due_date, 'active')
  RETURNING id INTO v_new_assignment_id;

  -- 2. Chuyển bài cũ sang trạng thái 'archived' và lưu vết replaced_by
  UPDATE public.assignments
  SET status = 'archived',
      archived_at = NOW(),
      replaced_by = v_new_assignment_id
  WHERE id = p_assignment_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'archived_and_created_new',
    'new_assignment_id', v_new_assignment_id,
    'message', 'Đã lưu trữ bài giao cũ và tạo bài giao mới thành công. Lịch sử làm bài của học sinh được bảo toàn 100%.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_assignment_safely(UUID, UUID, INT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_assignment_safely(UUID, UUID, INT, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- 8. RPC HỦY MỀM BÀI GIAO KIỂM TRA TRẠNG THÁI ACTIVE VÀ KHÓA FOR UPDATE
-- ============================================================================
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

  IF p_assignment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mã lượt giao bài không được để trống.');
  END IF;

  -- Khóa bản ghi bằng FOR UPDATE
  SELECT id, class_id, status INTO v_assign
  FROM public.assignments
  WHERE id = p_assignment_id FOR UPDATE;

  IF v_assign.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài không tồn tại.');
  END IF;

  -- BẮT BUỘC KIỂM TRA: CHỈ CHO PHÉP HỦY BÀI CÓ STATUS = 'active'
  IF v_assign.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lượt giao bài này không ở trạng thái hoạt động (đã lưu trữ hoặc đã hủy), không thể hủy thêm.');
  END IF;

  -- KIỂM TRA QUYỀN SỞ HỮU LỚP HOẶC ADMIN
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

-- ============================================================================
-- 9. RPC XÓA GAME AN TOÀN DÀNH CHO ADMIN (CHỈ XÓA KHI CHƯA TỪNG ĐƯỢC SỬ DỤNG)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_game_safely(p_game_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_assign_count INT;
  v_progress_count INT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  IF p_game_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mã trò chơi không được để trống.');
  END IF;

  -- Chỉ Admin mới có quyền gọi RPC xóa game
  IF NOT app_private.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Admin mới có quyền xóa trò chơi khỏi kho.');
  END IF;

  -- Kiểm tra game tồn tại
  IF NOT EXISTS (SELECT 1 FROM public.games WHERE id = p_game_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trò chơi không tồn tại.');
  END IF;

  -- Kiểm tra xem trò chơi đã từng được giao chưa
  SELECT COUNT(*) INTO v_assign_count
  FROM public.assignments
  WHERE game_id = p_game_id;

  -- Kiểm tra xem trò chơi đã từng có tiến độ làm bài chưa
  SELECT COUNT(*) INTO v_progress_count
  FROM public.student_progress
  WHERE game_id = p_game_id;

  IF v_assign_count > 0 OR v_progress_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Trò chơi này đã được giao hoặc có lịch sử làm bài của học sinh, không thể xóa để bảo toàn dữ liệu. Hãy ẩn trò chơi bằng cách bỏ chọn Công khai (is_public = false).'
    );
  END IF;

  DELETE FROM public.games WHERE id = p_game_id;

  RETURN jsonb_build_object('success', true, 'message', 'Đã xóa trò chơi chưa từng được sử dụng thành công.');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_game_safely(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_game_safely(UUID) TO authenticated;

COMMIT;
