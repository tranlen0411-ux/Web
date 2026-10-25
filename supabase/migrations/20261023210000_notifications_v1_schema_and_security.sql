-- ============================================================================
-- NOTIFICATIONS V1: SCHEMA, MIGRATION & SECURITY HARDENING (FINAL PRE-STAGING GATE)
-- Workspace: Web-notifications
-- Branch: feature/notifications-v1
-- ============================================================================

-- ============================================================================
-- 1. KHỞI TẠO SCHEMA NỘI BỘ (SAFE ISOLATION, NO GLOBAL REVOKE)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS notifications_private;
REVOKE ALL ON SCHEMA notifications_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA notifications_private TO authenticated, service_role;

-- ============================================================================
-- 2. BẢNG CHÍNH: NOTIFICATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name_snapshot TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  category TEXT NOT NULL DEFAULT 'general',
  target_type TEXT NOT NULL,
  target_grade_level INT,
  target_class_ids UUID[] NOT NULL DEFAULT '{}',
  linked_resource_type TEXT,
  linked_resource_id UUID,
  link_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  is_recalled BOOLEAN NOT NULL DEFAULT FALSE,
  recalled_at TIMESTAMPTZ,
  recalled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recall_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_notifications_title CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 255),
  CONSTRAINT chk_notifications_content CHECK (char_length(trim(content)) > 0),
  CONSTRAINT chk_notifications_priority CHECK (priority IN ('normal', 'urgent', 'high', 'low')),
  CONSTRAINT chk_notifications_category CHECK (category IN ('general', 'exercise', 'material', 'exam', 'system')),
  CONSTRAINT chk_notifications_target_type CHECK (target_type IN ('all', 'grade', 'classes')),
  CONSTRAINT chk_notifications_target_scope CHECK (
    (target_type = 'classes' AND array_length(target_class_ids, 1) > 0 AND target_grade_level IS NULL) OR
    (target_type = 'grade' AND target_grade_level BETWEEN 1 AND 5 AND (target_class_ids IS NULL OR target_class_ids = '{}')) OR
    (target_type = 'all' AND target_grade_level IS NULL AND (target_class_ids IS NULL OR target_class_ids = '{}'))
  ),
  CONSTRAINT chk_notifications_linked_resource CHECK (
    linked_resource_type IS NULL OR linked_resource_type IN ('exercise', 'material', 'exam', 'game')
  ),
  CONSTRAINT chk_notifications_published_state CHECK (
    (is_published = FALSE AND published_at IS NULL) OR
    (is_published = TRUE AND published_at IS NOT NULL)
  ),
  CONSTRAINT chk_notifications_recalled_state CHECK (
    (is_recalled = FALSE AND recalled_at IS NULL) OR
    (is_recalled = TRUE AND recalled_at IS NOT NULL)
  )
);

-- ============================================================================
-- 3. BẢNG LIÊN KẾT LỚP HỌC MỤC TIÊU (FOREIGN KEY INTEGRITY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_classes (
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, class_id)
);

-- ============================================================================
-- 4. BẢNG TRẠNG THÁI NGƯỜI NHẬN CỐ ĐỊNH (SNAPSHOT MODEL AT PUBLISH)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notification_recipient UNIQUE (notification_id, recipient_id),
  CONSTRAINT chk_recipients_read_state CHECK (
    (is_read = FALSE AND read_at IS NULL) OR
    (is_read = TRUE AND read_at IS NOT NULL)
  )
);

-- ============================================================================
-- 5. SIẾT CHẶT QUYỀN TRUY CẬP BẢNG TỪNG ROLE (LEAST PRIVILEGE)
-- Frontend chỉ có quyền SELECT trên notification_classes và notification_recipients
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO authenticated;

GRANT SELECT ON TABLE public.notification_classes TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notification_classes FROM authenticated, anon, PUBLIC;

GRANT SELECT ON TABLE public.notification_recipients TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notification_recipients FROM authenticated, anon, PUBLIC;

-- ============================================================================
-- 6. CHỈ MỤC HIỆU NĂNG CAO (INDEXES)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_notifications_sender ON public.notifications(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_published ON public.notifications(is_published, is_recalled, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_recipients_user_unread ON public.notification_recipients(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_recipients_notif ON public.notification_recipients(notification_id);
CREATE INDEX IF NOT EXISTS idx_notif_classes_class ON public.notification_classes(class_id);

-- ============================================================================
-- 7. CÁC HÀM NỘI BỘ TRONG SCHEMA NOTIFICATIONS_PRIVATE (ZERO TRUST, ANTI-RECURSION)
-- ============================================================================

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_get_caller_profile()
RETURNS TABLE (user_id UUID, user_role TEXT, is_disabled BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.role, COALESCE(p.is_disabled, FALSE)
  FROM public.profiles p
  WHERE p.id = auth.uid();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_get_caller_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_get_caller_profile() TO service_role;

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_disabled = FALSE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_is_active_teacher()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'teacher' AND is_disabled = FALSE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_is_active_teacher() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_is_active_teacher() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_is_sender(p_notification_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE id = p_notification_id AND sender_id IS NOT NULL AND sender_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_is_sender(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_is_sender(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_is_recipient(p_notification_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notification_recipients
    WHERE notification_id = p_notification_id AND recipient_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_is_recipient(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_is_recipient(UUID) TO authenticated, service_role;

-- Hàm kiểm tra lớp: ZERO TRUST, tự xác thực danh tính caller từ auth.uid() và profiles
CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_validate_and_dedup_classes(
  p_class_ids UUID[]
) RETURNS UUID[] AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_role TEXT;
  v_is_disabled BOOLEAN;
  v_deduped UUID[];
  v_count INT;
  v_teacher_count INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  SELECT role, COALESCE(is_disabled, FALSE) INTO v_role, v_is_disabled
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  IF v_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only admins and teachers can target classes.';
  END IF;

  IF p_class_ids IS NULL OR array_length(p_class_ids, 1) IS NULL OR array_length(p_class_ids, 1) = 0 THEN
    RAISE EXCEPTION 'INVALID_TARGET: Target class list cannot be empty for class notifications.';
  END IF;

  -- 1. Deduplicate UUID mảng đầu vào
  SELECT ARRAY(SELECT DISTINCT unnest(p_class_ids)) INTO v_deduped;

  -- 2. Kiểm tra tất cả lớp có tồn tại trong public.classes hay không
  SELECT count(*) INTO v_count
  FROM public.classes
  WHERE id = ANY(v_deduped);

  IF v_count != array_length(v_deduped, 1) THEN
    RAISE EXCEPTION 'INVALID_CLASS: One or more target classes do not exist.';
  END IF;

  -- 3. Nếu là Teacher, tự động kiểm tra quyền sở hữu lớp dựa trên v_caller_id
  IF v_role = 'teacher' THEN
    SELECT count(*) INTO v_teacher_count
    FROM public.classes
    WHERE id = ANY(v_deduped) AND teacher_id = v_caller_id;

    IF v_teacher_count != array_length(v_deduped, 1) THEN
      RAISE EXCEPTION 'FORBIDDEN_CLASS: Teachers can only send notifications to classes they manage.';
    END IF;
  END IF;

  RETURN v_deduped;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_validate_and_dedup_classes(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_validate_and_dedup_classes(UUID[]) TO service_role;

-- ============================================================================
-- 8. TRIGGER BEFORE INSERT: CHUẨN HÓA MỤC TIÊU VÀ PHÂN QUYỀN TẠO THÔNG BÁO
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_notifications_before_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_caller RECORD;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  v_is_admin := (v_caller.user_role = 'admin');

  IF v_caller.user_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only admins and teachers can create notifications.';
  END IF;

  IF NEW.sender_id IS NOT NULL AND NEW.sender_id != v_caller.user_id THEN
    RAISE EXCEPTION 'FORBIDDEN_SENDER_IMPERSONATION: Cannot set sender_id to another user.';
  END IF;

  NEW.sender_id := v_caller.user_id;
  SELECT full_name INTO NEW.sender_name_snapshot
  FROM public.profiles
  WHERE id = v_caller.user_id;

  IF NOT v_is_admin AND NEW.target_type IN ('all', 'grade') THEN
    RAISE EXCEPTION 'FORBIDDEN_TARGET_SCOPE: Only admins can broadcast notifications to entire grade or school.';
  END IF;

  IF NEW.target_type = 'classes' THEN
    NEW.target_grade_level := NULL;
    NEW.target_class_ids := notifications_private.fn_notifications_validate_and_dedup_classes(NEW.target_class_ids);
  ELSIF NEW.target_type = 'grade' THEN
    IF NEW.target_grade_level IS NULL OR NEW.target_grade_level NOT BETWEEN 1 AND 5 THEN
      RAISE EXCEPTION 'INVALID_GRADE_LEVEL: Grade level must be between 1 and 5.';
    END IF;
    NEW.target_class_ids := '{}';
  ELSIF NEW.target_type = 'all' THEN
    NEW.target_grade_level := NULL;
    NEW.target_class_ids := '{}';
  ELSE
    RAISE EXCEPTION 'INVALID_TARGET_TYPE: Unsupported target_type.';
  END IF;

  IF NEW.is_published = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_DIRECT_PUBLISH: Notifications must be created as drafts first, then published via rpc_publish_notification.';
  END IF;

  NEW.published_at := NULL;
  NEW.is_recalled := FALSE;
  NEW.recalled_at := NULL;
  NEW.recalled_by := NULL;
  NEW.recall_reason := NULL;
  NEW.created_at := NOW();
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

DROP TRIGGER IF EXISTS trg_notifications_before_insert ON public.notifications;
CREATE TRIGGER trg_notifications_before_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notifications_before_insert();

-- ============================================================================
-- 9. TRIGGER BEFORE UPDATE: BẢO VỆ CHU TRÌNH SỐNG, CHỐNG UNPUBLISH, CHỐNG XUẤT BẢN LẠI KHI ĐÃ THU HỒI
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_notifications_protect_lifecycle()
RETURNS TRIGGER AS $$
DECLARE
  v_caller RECORD;
  v_is_admin BOOLEAN;
BEGIN
  -- 0. Xử lý Foreign Key ON DELETE SET NULL từ hệ thống khi xóa profile người gửi:
  -- Chỉ cho phép hệ thống FK gán sender_id = NULL khi profile thật sự bị xóa, và khóa cứng mọi trường khác về OLD
  IF OLD.sender_id IS NOT NULL AND NEW.sender_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.sender_id) THEN
      RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: sender_id cannot be set to NULL directly while the user profile exists.'
        USING ERRCODE = '42501';
    END IF;

    -- Bảo vệ tuyệt đối: Khôi phục toàn bộ các trường khác về giá trị cũ OLD, chỉ chấp nhận gán sender_id = NULL
    NEW := OLD;
    NEW.sender_id := NULL;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  v_is_admin := (v_caller.user_role = 'admin');

  -- KIỂM TRA QUYỀN VAI TRÒ HIỆN TẠI (ROLE AT RUNTIME):
  -- Chỉ Admin hoặc Giáo viên còn đang active và là chính chủ mới được sửa/quản lý thông báo
  IF NOT v_is_admin THEN
    IF v_caller.user_role != 'teacher' OR OLD.sender_id IS NULL OR OLD.sender_id != v_caller.user_id THEN
      RAISE EXCEPTION 'FORBIDDEN_ROLE: Only active admins and active teachers can update or manage notifications.';
    END IF;
  END IF;

  -- 1. BẢO VỆ SENDER_ID BẤT BIẾN TUYỆT ĐỐI (TRỪ KHI SYSTEM SET NULL KHI XÓA PROFILE)
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: sender_id cannot be changed.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. BẢO VỆ CREATED_AT VÀ SENDER_NAME_SNAPSHOT BẤT BIẾN
  NEW.created_at := OLD.created_at;
  NEW.sender_name_snapshot := OLD.sender_name_snapshot;

  -- 3. CHỐNG SỬA ĐỔI HOẶC XUẤT BẢN LẠI KHI ĐÃ THU HỒI (is_recalled = TRUE)
  IF OLD.is_recalled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLISH_RECALLED: Cannot modify, publish, or re-publish a recalled notification.';
  END IF;

  -- 4. ĐÓNG LỖ HỔNG: CHỐNG CHUYỂN is_published TỪ TRUE VỀ FALSE
  IF OLD.is_published = TRUE AND NEW.is_published = FALSE THEN
    RAISE EXCEPTION 'FORBIDDEN_UNPUBLISH: A published notification cannot be reverted to draft. Use recall instead.';
  END IF;

  -- 5. KHI THÔNG BÁO ĐÃ PHÁT HÀNH: KHÓA BẤT BIẾN TOÀN BỘ NỘI DUNG, LIÊN KẾT, MỤC TIÊU VÀ ĐỘ ƯU TIÊN
  IF OLD.is_published = TRUE THEN
    IF (NEW.title IS DISTINCT FROM OLD.title) OR
       (NEW.content IS DISTINCT FROM OLD.content) OR
       (NEW.priority IS DISTINCT FROM OLD.priority) OR
       (NEW.category IS DISTINCT FROM OLD.category) OR
       (NEW.target_type IS DISTINCT FROM OLD.target_type) OR
       (NEW.target_grade_level IS DISTINCT FROM OLD.target_grade_level) OR
       (NEW.target_class_ids IS DISTINCT FROM OLD.target_class_ids) OR
       (NEW.linked_resource_type IS DISTINCT FROM OLD.linked_resource_type) OR
       (NEW.linked_resource_id IS DISTINCT FROM OLD.linked_resource_id) OR
       (NEW.link_url IS DISTINCT FROM OLD.link_url) THEN
      RAISE EXCEPTION 'FORBIDDEN_MODIFICATION_PUBLISHED: Cannot alter content, priority, category, links, or targets of an already published notification. Recall and create a new notification instead.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.target_type = 'classes' THEN
      NEW.target_grade_level := NULL;
      NEW.target_class_ids := notifications_private.fn_notifications_validate_and_dedup_classes(NEW.target_class_ids);
    ELSIF NEW.target_type = 'grade' THEN
      IF NOT v_is_admin THEN
        RAISE EXCEPTION 'FORBIDDEN_TARGET_SCOPE: Only admins can target entire grade.';
      END IF;
      IF NEW.target_grade_level IS NULL OR NEW.target_grade_level NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'INVALID_GRADE_LEVEL: Grade level must be between 1 and 5.';
      END IF;
      NEW.target_class_ids := '{}';
    ELSIF NEW.target_type = 'all' THEN
      IF NOT v_is_admin THEN
        RAISE EXCEPTION 'FORBIDDEN_TARGET_SCOPE: Only admins can target all users.';
      END IF;
      NEW.target_grade_level := NULL;
      NEW.target_class_ids := '{}';
    END IF;
  END IF;

  -- 6. CHỐNG HỦY TRẠNG THÁI THU HỒI (is_recalled: TRUE -> FALSE)
  IF OLD.is_recalled = TRUE AND NEW.is_recalled = FALSE THEN
    RAISE EXCEPTION 'FORBIDDEN_REVERT_RECALL: A recalled notification cannot be un-recalled.';
  END IF;

  -- 7. BẢO VỆ published_at: CHỈ SERVER QUYẾT ĐỊNH THỜI ĐIỂM, KHÔNG CHẤP NHẬN TỰ KHAI BÁO
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

DROP TRIGGER IF EXISTS trg_notifications_protect_lifecycle ON public.notifications;
CREATE TRIGGER trg_notifications_protect_lifecycle
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notifications_protect_lifecycle();

-- ============================================================================
-- 10. TRIGGER AFTER INSERT/UPDATE: ĐỒNG BỘ TARGET CLASSES VÀ TẠO SNAPSHOT RECIPIENTS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_notifications_after_save()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_published = FALSE THEN
    DELETE FROM public.notification_classes WHERE notification_id = NEW.id;

    IF NEW.target_type = 'classes' AND array_length(NEW.target_class_ids, 1) > 0 THEN
      INSERT INTO public.notification_classes (notification_id, class_id)
      SELECT NEW.id, unnest(NEW.target_class_ids)
      ON CONFLICT (notification_id, class_id) DO NOTHING;
    ELSIF NEW.target_type = 'grade' AND NEW.target_grade_level IS NOT NULL THEN
      INSERT INTO public.notification_classes (notification_id, class_id)
      SELECT NEW.id, c.id
      FROM public.classes c
      WHERE c.grade_level = NEW.target_grade_level
      ON CONFLICT (notification_id, class_id) DO NOTHING;
    END IF;
  END IF;

  IF NEW.is_published = TRUE AND (OLD IS NULL OR OLD.is_published = FALSE) THEN
    -- Trường hợp 1: Theo danh sách lớp
    IF NEW.target_type = 'classes' THEN
      INSERT INTO public.notification_recipients (notification_id, recipient_id, created_at)
      SELECT DISTINCT NEW.id, cm.student_id, NOW()
      FROM public.class_members cm
      JOIN public.profiles p ON p.id = cm.student_id
      WHERE cm.class_id = ANY(NEW.target_class_ids)
        AND cm.is_active = TRUE
        AND p.role = 'student'
        AND p.is_disabled = FALSE
      ON CONFLICT (notification_id, recipient_id) DO NOTHING;

    -- Trường hợp 2: Theo khối lớp (Grade 1-5)
    ELSIF NEW.target_type = 'grade' THEN
      INSERT INTO public.notification_recipients (notification_id, recipient_id, created_at)
      SELECT DISTINCT NEW.id, cm.student_id, NOW()
      FROM public.classes c
      JOIN public.class_members cm ON cm.class_id = c.id
      JOIN public.profiles p ON p.id = cm.student_id
      WHERE c.grade_level = NEW.target_grade_level
        AND cm.is_active = TRUE
        AND p.role = 'student'
        AND p.is_disabled = FALSE
      ON CONFLICT (notification_id, recipient_id) DO NOTHING;

    -- Trường hợp 3: Toàn trường (Chỉ student và teacher active; loại trừ parent và caller)
    ELSIF NEW.target_type = 'all' THEN
      INSERT INTO public.notification_recipients (notification_id, recipient_id, created_at)
      SELECT DISTINCT NEW.id, p.id, NOW()
      FROM public.profiles p
      WHERE p.is_disabled = FALSE
        AND p.role IN ('student', 'teacher')
        AND p.id != NEW.sender_id
      ON CONFLICT (notification_id, recipient_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

DROP TRIGGER IF EXISTS trg_notifications_after_save ON public.notifications;
CREATE TRIGGER trg_notifications_after_save
  AFTER INSERT OR UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notifications_after_save();

-- ============================================================================
-- 11. TRIGGER BẢO VỆ BẢNG NOTIFICATION_CLASSES CHỐNG SỬA TRỰC TIẾP TỪ BÊN NGOÀI
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_notification_classes_lock_published()
RETURNS TRIGGER AS $$
DECLARE
  v_notif_id UUID;
  v_is_pub BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_notif_id := OLD.notification_id;
  ELSE
    v_notif_id := NEW.notification_id;
  END IF;

  SELECT is_published INTO v_is_pub FROM public.notifications WHERE id = v_notif_id;
  IF v_is_pub = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_TARGET_MODIFICATION: Cannot alter target classes of an already published notification.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

DROP TRIGGER IF EXISTS trg_notification_classes_lock_published ON public.notification_classes;
CREATE TRIGGER trg_notification_classes_lock_published
  BEFORE INSERT OR UPDATE OR DELETE ON public.notification_classes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notification_classes_lock_published();

-- ============================================================================
-- 12. TRIGGER BẢO VỆ BẢNG NOTIFICATION_RECIPIENTS VÀ TIMESTAMP READ_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_notification_recipients_protect_read()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.notification_id IS DISTINCT FROM OLD.notification_id OR
     NEW.recipient_id IS DISTINCT FROM OLD.recipient_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: recipient_id, notification_id, and created_at cannot be changed.';
  END IF;

  IF OLD.is_read = FALSE AND NEW.is_read = TRUE THEN
    NEW.read_at := NOW();
  ELSIF OLD.is_read = TRUE AND NEW.is_read = TRUE THEN
    NEW.read_at := OLD.read_at;
  ELSIF OLD.is_read = TRUE AND NEW.is_read = FALSE THEN
    RAISE EXCEPTION 'FORBIDDEN_REVERT_READ: Cannot mark a read notification as unread.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

DROP TRIGGER IF EXISTS trg_notification_recipients_protect_read ON public.notification_recipients;
CREATE TRIGGER trg_notification_recipients_protect_read
  BEFORE UPDATE ON public.notification_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notification_recipients_protect_read();

-- ============================================================================
-- 13. BẬT ROW LEVEL SECURITY (RLS) & FORCE RLS
-- ============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_classes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_recipients FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 14. RLS POLICIES CHO BẢNG NOTIFICATIONS
-- ============================================================================

DROP POLICY IF EXISTS "rls_notifications_select" ON public.notifications;
CREATE POLICY "rls_notifications_select" ON public.notifications
FOR SELECT TO authenticated
USING (
  notifications_private.fn_notifications_is_admin()
  OR (notifications_private.fn_notifications_is_active_teacher() AND notifications.sender_id = auth.uid())
  OR (
    notifications.is_published = TRUE
    AND notifications.is_recalled = FALSE
    AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_disabled = FALSE
    )
    AND notifications_private.fn_notifications_is_recipient(notifications.id)
  )
);

DROP POLICY IF EXISTS "rls_notifications_insert" ON public.notifications;
CREATE POLICY "rls_notifications_insert" ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
  notifications.sender_id = auth.uid()
  AND (
    notifications_private.fn_notifications_is_admin()
    OR notifications_private.fn_notifications_is_active_teacher()
  )
);

DROP POLICY IF EXISTS "rls_notifications_update" ON public.notifications;
CREATE POLICY "rls_notifications_update" ON public.notifications
FOR UPDATE TO authenticated
USING (
  notifications_private.fn_notifications_is_admin()
  OR (notifications_private.fn_notifications_is_active_teacher() AND notifications.sender_id = auth.uid())
)
WITH CHECK (
  notifications_private.fn_notifications_is_admin()
  OR (notifications_private.fn_notifications_is_active_teacher() AND notifications.sender_id = auth.uid())
);

DROP POLICY IF EXISTS "rls_notifications_delete" ON public.notifications;
CREATE POLICY "rls_notifications_delete" ON public.notifications
FOR DELETE TO authenticated
USING (
  notifications.is_published = FALSE
  AND (
    notifications_private.fn_notifications_is_admin()
    OR (notifications_private.fn_notifications_is_active_teacher() AND notifications.sender_id = auth.uid())
  )
);

-- ============================================================================
-- 15. RLS POLICIES CHO BẢNG NOTIFICATION_CLASSES
-- ============================================================================
DROP POLICY IF EXISTS "rls_notif_classes_select" ON public.notification_classes;
CREATE POLICY "rls_notif_classes_select" ON public.notification_classes
FOR SELECT TO authenticated
USING (
  notifications_private.fn_notifications_is_admin()
  OR notifications_private.fn_notifications_is_sender(notification_classes.notification_id)
  OR notifications_private.fn_notifications_is_recipient(notification_classes.notification_id)
);

-- ============================================================================
-- 16. RLS POLICIES CHO BẢNG NOTIFICATION_RECIPIENTS
-- ============================================================================
DROP POLICY IF EXISTS "rls_notif_recipients_select" ON public.notification_recipients;
CREATE POLICY "rls_notif_recipients_select" ON public.notification_recipients
FOR SELECT TO authenticated
USING (
  (
    notification_recipients.recipient_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_disabled = FALSE
    )
  )
  OR notifications_private.fn_notifications_is_admin()
  OR notifications_private.fn_notifications_is_sender(notification_recipients.notification_id)
);

-- ============================================================================
-- 17. CÁC HÀM NGHIỆP VỤ RPC AN TOÀN CAO (SECURITY DEFINER, STRICT AUDIT)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_create_notification(
  p_title TEXT,
  p_content TEXT,
  p_priority TEXT DEFAULT 'normal',
  p_category TEXT DEFAULT 'general',
  p_target_type TEXT DEFAULT 'classes',
  p_target_grade_level INT DEFAULT NULL,
  p_target_class_ids UUID[] DEFAULT '{}',
  p_linked_resource_type TEXT DEFAULT NULL,
  p_linked_resource_id UUID DEFAULT NULL,
  p_link_url TEXT DEFAULT NULL,
  p_publish_now BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  v_caller RECORD;
  v_new_id UUID;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  INSERT INTO public.notifications (
    sender_id,
    title,
    content,
    priority,
    category,
    target_type,
    target_grade_level,
    target_class_ids,
    linked_resource_type,
    linked_resource_id,
    link_url,
    is_published
  ) VALUES (
    v_caller.user_id,
    p_title,
    p_content,
    p_priority,
    p_category,
    p_target_type,
    p_target_grade_level,
    p_target_class_ids,
    p_linked_resource_type,
    p_linked_resource_id,
    p_link_url,
    FALSE
  )
  RETURNING id INTO v_new_id;

  IF p_publish_now = TRUE THEN
    UPDATE public.notifications
    SET is_published = TRUE
    WHERE id = v_new_id;
  END IF;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

CREATE OR REPLACE FUNCTION public.rpc_publish_notification(
  p_notification_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_caller RECORD;
  v_notif RECORD;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

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

CREATE OR REPLACE FUNCTION public.rpc_recall_notification(
  p_notification_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_caller RECORD;
  v_notif RECORD;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  SELECT * INTO v_notif FROM public.notifications WHERE id = p_notification_id;

  IF v_notif.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Notification does not exist.';
  END IF;

  -- Kiểm tra vai trò thực tế hiện tại của người gọi
  IF v_caller.user_role = 'admin' THEN
    NULL; -- Admin có toàn quyền
  ELSIF v_caller.user_role = 'teacher' AND v_notif.sender_id IS NOT NULL AND v_notif.sender_id = v_caller.user_id THEN
    NULL; -- Giáo viên active chỉ được thu hồi thông báo do chính mình tạo
  ELSE
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only active admins and active teachers can recall notifications.';
  END IF;

  IF v_notif.is_recalled = TRUE THEN
    RETURN TRUE;
  END IF;

  UPDATE public.notifications
  SET is_recalled = TRUE,
      recall_reason = p_reason
  WHERE id = p_notification_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

-- Đánh dấu đã đọc: Xác minh đã xuất bản, chưa thu hồi và đúng người nhận
CREATE OR REPLACE FUNCTION public.rpc_mark_notification_as_read(
  p_notification_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_caller RECORD;
  v_notif RECORD;
  v_rows_updated INT;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  -- 1. Kiểm tra thông báo cha: Phải tồn tại, đã xuất bản và chưa thu hồi
  SELECT id, is_published, is_recalled INTO v_notif
  FROM public.notifications
  WHERE id = p_notification_id;

  IF v_notif.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Notification does not exist.';
  END IF;

  IF v_notif.is_published = FALSE THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_PUBLISHED: Cannot mark an unpublished notification as read.';
  END IF;

  IF v_notif.is_recalled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_RECALLED: Cannot mark a recalled notification as read.';
  END IF;

  -- 2. Kiểm tra và cập nhật trạng thái đọc của người nhận
  UPDATE public.notification_recipients
  SET is_read = TRUE,
      read_at = NOW()
  WHERE notification_id = p_notification_id
    AND recipient_id = v_caller.user_id
    AND is_read = FALSE;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_recipients
      WHERE notification_id = p_notification_id AND recipient_id = v_caller.user_id
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_RECIPIENT: You are not a recipient of this notification.';
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

CREATE OR REPLACE FUNCTION public.rpc_get_unread_notification_count()
RETURNS INT AS $$
DECLARE
  v_caller RECORD;
  v_count INT;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL OR v_caller.is_disabled = TRUE THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notification_recipients nr
  JOIN public.notifications n ON n.id = nr.notification_id
  WHERE nr.recipient_id = v_caller.user_id
    AND nr.is_read = FALSE
    AND n.is_published = TRUE
    AND n.is_recalled = FALSE;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

CREATE OR REPLACE FUNCTION public.rpc_get_my_notifications(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_unread_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  priority TEXT,
  category TEXT,
  linked_resource_type TEXT,
  linked_resource_id UUID,
  link_url TEXT,
  published_at TIMESTAMPTZ,
  sender_name TEXT,
  is_read BOOLEAN,
  read_at TIMESTAMPTZ
) AS $$
DECLARE
  v_caller RECORD;
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL OR v_caller.is_disabled = TRUE THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.title,
    n.content,
    n.priority,
    n.category,
    n.linked_resource_type,
    n.linked_resource_id,
    n.link_url,
    n.published_at,
    COALESCE(NULLIF(trim(n.sender_name_snapshot), ''), p.full_name, 'Hệ thống') AS sender_name,
    nr.is_read,
    nr.read_at
  FROM public.notification_recipients nr
  JOIN public.notifications n ON n.id = nr.notification_id
  LEFT JOIN public.profiles p ON p.id = n.sender_id
  WHERE nr.recipient_id = v_caller.user_id
    AND n.is_published = TRUE
    AND n.is_recalled = FALSE
    AND (NOT p_unread_only OR nr.is_read = FALSE)
  ORDER BY
    CASE WHEN n.priority = 'urgent' THEN 1 WHEN n.priority = 'high' THEN 2 ELSE 3 END ASC,
    n.published_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
  OFFSET GREATEST(p_offset, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

-- ============================================================================
-- 18. QUẢN LÝ QUYỀN TRUY CẬP RPC CHO CLIENT
-- ============================================================================
REVOKE ALL ON FUNCTION public.rpc_create_notification(TEXT, TEXT, TEXT, TEXT, TEXT, INT, UUID[], TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_notification(TEXT, TEXT, TEXT, TEXT, TEXT, INT, UUID[], TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_publish_notification(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_publish_notification(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_recall_notification(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_recall_notification(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_mark_notification_as_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_mark_notification_as_read(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_get_unread_notification_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_unread_notification_count() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_get_my_notifications(INT, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_notifications(INT, INT, BOOLEAN) TO authenticated;
