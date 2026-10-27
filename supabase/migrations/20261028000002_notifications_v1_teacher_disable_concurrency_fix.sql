-- ============================================================================
-- NOTIFICATIONS V1 – PHASE NEXT: ĐỢT A – CONCURRENCY HARDENING
-- File: 20261028000002_notifications_v1_teacher_disable_concurrency_fix.sql
-- Mục tiêu: Khắc phục Race Condition khi Admin disable Teacher đồng thời với Publish Notification
-- Thiết lập tính tuần tự hóa nghiêm ngặt (Strict Serialization) qua RowShareLock (FOR SHARE)
-- trên profile người gửi tại thời điểm xuất bản (Publish Time).
-- Bảo toàn 100% chữ ký RPC cũ, bảo toàn tương thích ngược all/grade/classes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HÀM NỘI BỘ: THẨM TRA VÀ KHÓA CHIA SẺ PROFILE NGƯỜI GỌI TẠI THỜI ĐIỂM THAY ĐỔI TRẠNG THÁI
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_lock_and_verify_caller()
RETURNS TABLE (user_id UUID, user_role TEXT, is_disabled BOOLEAN) AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_id UUID;
  v_role TEXT;
  v_disabled BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  -- Khóa hàng chia sẻ (RowShareLock) trên profile của chính caller
  -- Cơ chế này ngăn chặn race condition khi Admin đang UPDATE is_disabled = true
  SELECT p.id, p.role, COALESCE(p.is_disabled, FALSE)
  INTO v_user_id, v_role, v_disabled
  FROM public.profiles p
  WHERE p.id = v_uid
  FOR SHARE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User profile not found.';
  END IF;

  IF v_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  IF v_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only active admins and active teachers can perform this action.';
  END IF;

  RETURN QUERY SELECT v_user_id, v_role, v_disabled;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_lock_and_verify_caller() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_lock_and_verify_caller() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. CẬP NHẬT PUBLIC.RPC_PUBLISH_NOTIFICATION ĐỂ KHÓA ĐỒNG BỘ TRƯỚC KHI UPDATE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_publish_notification(
  p_notification_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_caller RECORD;
  v_notif RECORD;
BEGIN
  -- Khóa chia sẻ trên profile caller ngay đầu transaction publish
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_lock_and_verify_caller();

  SELECT * INTO v_notif FROM public.notifications WHERE id = p_notification_id;

  IF v_notif.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Notification does not exist.';
  END IF;

  -- Chặn xuất bản hoặc xuất bản lại thông báo đã thu hồi
  IF v_notif.is_recalled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLISH_RECALLED: Cannot publish or re-publish a recalled notification.';
  END IF;

  -- Kiểm tra vai trò thực tế hiện tại của người gọi
  IF v_caller.user_role = 'admin' THEN
    NULL; -- Admin có toàn quyền
  ELSIF v_caller.user_role = 'teacher' AND v_notif.sender_id IS NOT NULL AND v_notif.sender_id = v_caller.user_id THEN
    NULL; -- Giáo viên active chỉ được xuất bản thông báo do chính mình tạo
  ELSE
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only active admins and active teachers can publish notifications.';
  END IF;

  IF v_notif.is_published = TRUE THEN
    RETURN TRUE;
  END IF;

  UPDATE public.notifications
  SET is_published = TRUE
  WHERE id = p_notification_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_publish_notification(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_publish_notification(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. CẬP NHẬT PUBLIC.FN_NOTIFICATIONS_PROTECT_LIFECYCLE ĐỂ KHÓA BẢO VỆ Ở TẦNG TRIGGER
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_notifications_protect_lifecycle()
RETURNS TRIGGER AS $$
DECLARE
  v_caller RECORD;
  v_is_admin BOOLEAN;
  v_student_name TEXT;
BEGIN
  -- 0a. Xử lý Foreign Key ON DELETE SET NULL khi xóa profile người gửi:
  IF OLD.sender_id IS NOT NULL AND NEW.sender_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.sender_id) THEN
      RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: sender_id cannot be set to NULL directly while the user profile exists.'
        USING ERRCODE = '42501';
    END IF;

    NEW := OLD;
    NEW.sender_id := NULL;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- 0b. Xử lý Foreign Key ON DELETE SET NULL khi xóa profile học sinh đích (target_student_id):
  IF OLD.target_student_id IS NOT NULL AND NEW.target_student_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.target_student_id) THEN
      RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: target_student_id cannot be set to NULL directly while the student profile exists.'
        USING ERRCODE = '42501';
    END IF;

    NEW := OLD;
    NEW.target_student_id := NULL;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- NẾU ĐANG CHUYỂN TRẠNG THÁI SANG PUBLISHED (is_published: FALSE -> TRUE):
  -- Áp dụng khóa chia sẻ (FOR SHARE) trên profile người gọi để tuần tự hóa với Admin Disable
  IF OLD.is_published = FALSE AND NEW.is_published = TRUE THEN
    SELECT * INTO v_caller FROM notifications_private.fn_notifications_lock_and_verify_caller();
  ELSE
    SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

    IF v_caller.user_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
    END IF;

    IF v_caller.is_disabled = TRUE THEN
      RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
    END IF;
  END IF;

  v_is_admin := (v_caller.user_role = 'admin');

  -- KIỂM TRA QUYỀN VAI TRÒ HIỆN TẠI (ROLE AT RUNTIME):
  IF NOT v_is_admin THEN
    IF v_caller.user_role != 'teacher' OR OLD.sender_id IS NULL OR OLD.sender_id != v_caller.user_id THEN
      RAISE EXCEPTION 'FORBIDDEN_ROLE: Only active admins and active teachers can update or manage notifications.';
    END IF;
  END IF;

  -- 1. BẢO VỆ SENDER_ID BẤT BIẾN
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: sender_id cannot be changed.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. BẢO VỆ CREATED_AT VÀ SENDER_NAME_SNAPSHOT BẤT BIẾN
  NEW.created_at := OLD.created_at;
  NEW.sender_name_snapshot := OLD.sender_name_snapshot;

  -- 3. CHỐNG SỬA ĐỔI HOẶC XUẤT BẢN LẠI KHI ĐÃ THU HỒI
  IF OLD.is_recalled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLISH_RECALLED: Cannot modify, publish, or re-publish a recalled notification.';
  END IF;

  -- 4. CHỐNG CHUYỂN is_published TỪ TRUE VỀ FALSE
  IF OLD.is_published = TRUE AND NEW.is_published = FALSE THEN
    RAISE EXCEPTION 'FORBIDDEN_UNPUBLISH: A published notification cannot be reverted to draft. Use recall instead.';
  END IF;

  -- 5. KHI THÔNG BÁO ĐÃ PHÁT HÀNH: KHÓA BẤT BIẾN TOÀN BỘ NỘI DUNG, LIÊN KẾT, MỤC TIÊU
  IF OLD.is_published = TRUE THEN
    IF (NEW.title IS DISTINCT FROM OLD.title) OR
       (NEW.content IS DISTINCT FROM OLD.content) OR
       (NEW.priority IS DISTINCT FROM OLD.priority) OR
       (NEW.category IS DISTINCT FROM OLD.category) OR
       (NEW.target_type IS DISTINCT FROM OLD.target_type) OR
       (NEW.target_grade_level IS DISTINCT FROM OLD.target_grade_level) OR
       (NEW.target_class_ids IS DISTINCT FROM OLD.target_class_ids) OR
       (NEW.target_student_id IS DISTINCT FROM OLD.target_student_id) OR
       (NEW.target_student_name_snapshot IS DISTINCT FROM OLD.target_student_name_snapshot) OR
       (NEW.linked_resource_type IS DISTINCT FROM OLD.linked_resource_type) OR
       (NEW.linked_resource_id IS DISTINCT FROM OLD.linked_resource_id) OR
       (NEW.link_url IS DISTINCT FROM OLD.link_url) THEN
      RAISE EXCEPTION 'FORBIDDEN_MODIFICATION_PUBLISHED: Cannot alter content, priority, category, links, or targets of an already published notification. Recall and create a new notification instead.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- KHI LÀ BẢN NHÁP (DRAFT): CHUẨN HÓA VÀ THẨM ĐỊNH MỤC TIÊU
    IF NEW.target_type = 'classes' THEN
      NEW.target_grade_level := NULL;
      NEW.target_student_id := NULL;
      NEW.target_student_name_snapshot := NULL;
      NEW.target_class_ids := notifications_private.fn_notifications_validate_and_dedup_classes(NEW.target_class_ids);
    ELSIF NEW.target_type = 'grade' THEN
      IF NOT v_is_admin THEN
        RAISE EXCEPTION 'FORBIDDEN_TARGET_SCOPE: Only admins can target entire grade.';
      END IF;
      IF NEW.target_grade_level IS NULL OR NEW.target_grade_level NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'INVALID_GRADE_LEVEL: Grade level must be between 1 and 5.';
      END IF;
      NEW.target_class_ids := '{}';
      NEW.target_student_id := NULL;
      NEW.target_student_name_snapshot := NULL;
    ELSIF NEW.target_type = 'all' THEN
      IF NOT v_is_admin THEN
        RAISE EXCEPTION 'FORBIDDEN_TARGET_SCOPE: Only admins can target all users.';
      END IF;
      NEW.target_grade_level := NULL;
      NEW.target_class_ids := '{}';
      NEW.target_student_id := NULL;
      NEW.target_student_name_snapshot := NULL;
    ELSIF NEW.target_type = 'individual' THEN
      NEW.target_grade_level := NULL;
      NEW.target_class_ids := '{}';
      IF NEW.target_student_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_TARGET: Target student ID must be specified for individual notifications.';
      END IF;

      -- THẨM ĐỊNH 2 TẦNG (DUAL-GATE):
      -- Nếu đang chuyển trạng thái sang PUBLISHED: khóa quan hệ FOR SHARE (Gate 2)
      -- Nếu đang lưu bản nháp: thẩm định không khóa quan hệ (Gate 1)
      IF NEW.is_published = TRUE THEN
        PERFORM notifications_private.fn_notifications_validate_target_student(NEW.target_student_id, TRUE);
      ELSE
        PERFORM notifications_private.fn_notifications_validate_target_student(NEW.target_student_id, FALSE);
      END IF;

      SELECT full_name INTO v_student_name
      FROM public.profiles
      WHERE id = NEW.target_student_id;
      NEW.target_student_name_snapshot := v_student_name;
    END IF;
  END IF;

  -- 6. CHỐNG HỦY TRẠNG THÁI THU HỒI
  IF OLD.is_recalled = TRUE AND NEW.is_recalled = FALSE THEN
    RAISE EXCEPTION 'FORBIDDEN_REVERT_RECALL: A recalled notification cannot be un-recalled.';
  END IF;

  -- 7. BẢO VỆ published_at
  IF OLD.is_published = FALSE AND NEW.is_published = TRUE THEN
    NEW.published_at := NOW();
  ELSIF OLD.is_published = TRUE THEN
    NEW.published_at := OLD.published_at;
  ELSE
    NEW.published_at := NULL;
  END IF;

  -- 8. BẢO VỆ recalled_at VÀ recalled_by
  IF OLD.is_recalled = FALSE AND NEW.is_recalled = TRUE THEN
    NEW.recalled_at := NOW();
    NEW.recalled_by := v_caller.user_id;
  ELSIF OLD.is_recalled = TRUE THEN
    NEW.recalled_at := OLD.recalled_at;
    NEW.recalled_by := OLD.recalled_by;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;
