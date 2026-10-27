-- ============================================================================
-- NOTIFICATIONS V1 – PHASE NEXT: ĐỢT A – INDIVIDUAL NOTIFICATIONS (R1 CORRECTION)
-- File: 20261028000001_notifications_v1_individual_recipients.sql
-- Mục tiêu: Hỗ trợ gửi thông báo riêng cho một học sinh với phân quyền 2 tầng nghiêm ngặt
-- Bảo toàn tương thích ngược 100% với các thông báo all, grade, classes hiện tại
-- Khắc phục toàn bộ các điểm lệch trigger function, schema cột recipient_id, profile fields và lifecycle
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BỔ SUNG CỘT VÀO BẢNG NOTIFICATIONS
-- ----------------------------------------------------------------------------

-- Cột lưu UUID học sinh đích
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS target_student_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Cột snapshot họ tên học sinh tại thời điểm gửi/xuất bản phục vụ kiểm toán và tra cứu lịch sử
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS target_student_name_snapshot TEXT;

-- Chỉ mục tối ưu truy vấn thông báo theo học sinh đích
CREATE INDEX IF NOT EXISTS idx_notifications_target_student
ON public.notifications(target_student_id)
WHERE target_student_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. CẬP NHẬT RÀNG BUỘC CHECK MỤC TIÊU VÀ PHẠM VI (SCOPE CONSTRAINTS)
-- ----------------------------------------------------------------------------

-- Cập nhật ràng buộc loại mục tiêu target_type
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS chk_notifications_target_type;
ALTER TABLE public.notifications ADD CONSTRAINT chk_notifications_target_type
CHECK (target_type IN ('all', 'grade', 'classes', 'individual'));

-- Cập nhật ràng buộc phạm vi target_scope:
-- 1. classes: target_class_ids có phần tử, các trường khác NULL
-- 2. grade: target_grade_level từ 1-5, các trường khác NULL
-- 3. all: toàn bộ trường target chi tiết đều NULL
-- 4. individual: target_grade_level NULL, target_class_ids rỗng/NULL.
--    Giải quyết triệt để xung đột Account Deletion FK ON DELETE SET NULL:
--    Cho phép target_student_id IS NULL khi profile học sinh bị xóa khỏi hệ thống
--    (ở cả 3 trạng thái draft, published, recalled), miễn là có target_student_id HOẶC target_student_name_snapshot.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS chk_notifications_target_scope;
ALTER TABLE public.notifications ADD CONSTRAINT chk_notifications_target_scope CHECK (
  (target_type = 'classes' AND array_length(target_class_ids, 1) > 0 AND target_grade_level IS NULL AND target_student_id IS NULL) OR
  (target_type = 'grade' AND target_grade_level BETWEEN 1 AND 5 AND (target_class_ids IS NULL OR target_class_ids = '{}') AND target_student_id IS NULL) OR
  (target_type = 'all' AND target_grade_level IS NULL AND (target_class_ids IS NULL OR target_class_ids = '{}') AND target_student_id IS NULL) OR
  (target_type = 'individual' AND target_grade_level IS NULL AND (target_class_ids IS NULL OR target_class_ids = '{}') AND (
    target_student_id IS NOT NULL OR
    (is_published = TRUE AND target_student_id IS NULL) OR
    (target_student_id IS NULL AND target_student_name_snapshot IS NOT NULL)
  ))
);

-- ----------------------------------------------------------------------------
-- 3. HÀM KIỂM TRA QUYỀN HỌC SINH MỤC TIÊU (SCHEMA NỘI BỘ NOTIFICATIONS_PRIVATE)
-- Bắt buộc là VOLATILE vì có sử dụng khóa giao dịch SELECT FOR SHARE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notifications_private.fn_notifications_validate_target_student(
  p_student_id UUID,
  p_lock_relations BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
  v_caller RECORD;
  v_student RECORD;
  v_is_in_teacher_class BOOLEAN;
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TARGET: Target student ID cannot be null.';
  END IF;

  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  IF v_caller.user_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only admins and teachers can send individual notifications.';
  END IF;

  -- Khóa dòng profile của học sinh để đảm bảo tính nhất quán (chống vô hiệu hóa đồng thời)
  IF p_lock_relations = TRUE THEN
    SELECT id, role, is_disabled INTO v_student
    FROM public.profiles
    WHERE id = p_student_id
    FOR SHARE;
  ELSE
    SELECT id, role, is_disabled INTO v_student
    FROM public.profiles
    WHERE id = p_student_id;
  END IF;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STUDENT: Target student does not exist.';
  END IF;

  IF v_student.role != 'student' THEN
    RAISE EXCEPTION 'INVALID_STUDENT_ROLE: Target user is not a student.';
  END IF;

  IF v_student.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_STUDENT_DISABLED: Target student account is disabled.';
  END IF;

  -- Nếu là Giáo viên: Bắt buộc học sinh phải thuộc ít nhất một lớp mà giáo viên này đang trực tiếp phụ trách
  IF v_caller.user_role = 'teacher' THEN
    IF p_lock_relations = TRUE THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.classes c
        JOIN public.class_members cm ON cm.class_id = c.id
        WHERE c.teacher_id = v_caller.user_id
          AND cm.student_id = p_student_id
          AND cm.is_active = TRUE
        FOR SHARE OF c, cm
      ) INTO v_is_in_teacher_class;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.classes c
        JOIN public.class_members cm ON cm.class_id = c.id
        WHERE c.teacher_id = v_caller.user_id
          AND cm.student_id = p_student_id
          AND cm.is_active = TRUE
      ) INTO v_is_in_teacher_class;
    END IF;

    IF NOT v_is_in_teacher_class THEN
      RAISE EXCEPTION 'FORBIDDEN_STUDENT_NOT_IN_TEACHER_CLASSES: Target student is not in any active class managed by this teacher.';
    END IF;
  END IF;

  RETURN p_student_id;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION notifications_private.fn_notifications_validate_target_student(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notifications_private.fn_notifications_validate_target_student(UUID, BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. CẬP NHẬT TRIGGER FUNCTION BEFORE INSERT: PUBLIC.FN_NOTIFICATIONS_BEFORE_INSERT
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_notifications_before_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_caller RECORD;
  v_is_admin BOOLEAN;
  v_student_name TEXT;
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

  -- Lấy tên người gửi an toàn từ public.profiles (khắc phục caller profile field mismatch)
  SELECT full_name INTO NEW.sender_name_snapshot
  FROM public.profiles
  WHERE id = v_caller.user_id;

  IF NOT v_is_admin AND NEW.target_type IN ('all', 'grade') THEN
    RAISE EXCEPTION 'FORBIDDEN_TARGET_SCOPE: Only admins can broadcast notifications to entire grade or school.';
  END IF;

  IF NEW.target_type = 'classes' THEN
    NEW.target_grade_level := NULL;
    NEW.target_student_id := NULL;
    NEW.target_student_name_snapshot := NULL;
    NEW.target_class_ids := notifications_private.fn_notifications_validate_and_dedup_classes(NEW.target_class_ids);
  ELSIF NEW.target_type = 'grade' THEN
    IF NEW.target_grade_level IS NULL OR NEW.target_grade_level NOT BETWEEN 1 AND 5 THEN
      RAISE EXCEPTION 'INVALID_GRADE_LEVEL: Grade level must be between 1 and 5.';
    END IF;
    NEW.target_class_ids := '{}';
    NEW.target_student_id := NULL;
    NEW.target_student_name_snapshot := NULL;
  ELSIF NEW.target_type = 'all' THEN
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

    -- Thẩm định quyền đối với học sinh mục tiêu tại thời điểm tạo nháp (Gate 1)
    PERFORM notifications_private.fn_notifications_validate_target_student(NEW.target_student_id, FALSE);

    -- Lưu snapshot tên học sinh
    SELECT full_name INTO v_student_name
    FROM public.profiles
    WHERE id = NEW.target_student_id;
    NEW.target_student_name_snapshot := v_student_name;
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

-- Đảm bảo trigger gắn đúng vào function trong schema public
DROP TRIGGER IF EXISTS trg_notifications_before_insert ON public.notifications;
CREATE TRIGGER trg_notifications_before_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notifications_before_insert();

-- ----------------------------------------------------------------------------
-- 5. CẬP NHẬT TRIGGER FUNCTION BEFORE UPDATE: PUBLIC.FN_NOTIFICATIONS_PROTECT_LIFECYCLE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_notifications_protect_lifecycle()
RETURNS TRIGGER AS $$
DECLARE
  v_caller RECORD;
  v_is_admin BOOLEAN;
  v_student_name TEXT;
BEGIN
  -- 0a. Xử lý Foreign Key ON DELETE SET NULL từ hệ thống khi xóa profile người gửi:
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

  -- 0b. Xử lý Foreign Key ON DELETE SET NULL từ hệ thống khi xóa profile học sinh đích (target_student_id):
  -- Cho phép hệ thống xóa tài khoản học sinh an toàn mà không bị chặn bởi trigger lifecycle
  IF OLD.target_student_id IS NOT NULL AND NEW.target_student_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.target_student_id) THEN
      RAISE EXCEPTION 'FORBIDDEN_IMMUTABLE_FIELD: target_student_id cannot be set to NULL directly while the student profile exists.'
        USING ERRCODE = '42501';
    END IF;

    -- Khôi phục các trường khác về OLD, chỉ chấp nhận gán target_student_id = NULL
    NEW := OLD;
    NEW.target_student_id := NULL;
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

  -- 3. CHỐNG SỬA ĐỔI HOẶC XUẤT BẢN LẠI KHI ĐÃ THU HỒI (is_recalled = TRUE)
  IF OLD.is_recalled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLISH_RECALLED: Cannot modify, publish, or re-publish a recalled notification.';
  END IF;

  -- 4. CHỐNG CHUYỂN is_published TỪ TRUE VỀ FALSE
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
      -- Nếu đang chuyển trạng thái sang PUBLISHED: khóa giao dịch FOR SHARE (Gate 2)
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

  -- 6. CHỐNG HỦY TRẠNG THÁI THU HỒI (is_recalled: TRUE -> FALSE)
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

-- Đảm bảo trigger gắn đúng vào function trong schema public
DROP TRIGGER IF EXISTS trg_notifications_protect_lifecycle ON public.notifications;
CREATE TRIGGER trg_notifications_protect_lifecycle
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notifications_protect_lifecycle();

-- ----------------------------------------------------------------------------
-- 6. CẬP NHẬT TRIGGER FUNCTION AFTER SAVE: PUBLIC.FN_NOTIFICATIONS_AFTER_SAVE
-- ----------------------------------------------------------------------------

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

    -- Trường hợp 4: Gửi riêng cho một học sinh (individual)
    -- CHỈ 1 BẢN GHI DUY NHẤT VÀ DÙNG CHÍNH XÁC CỘT recipient_id
    ELSIF NEW.target_type = 'individual' AND NEW.target_student_id IS NOT NULL THEN
      INSERT INTO public.notification_recipients (notification_id, recipient_id, created_at)
      VALUES (NEW.id, NEW.target_student_id, NOW())
      ON CONFLICT (notification_id, recipient_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

-- Đảm bảo trigger gắn đúng vào function trong schema public
DROP TRIGGER IF EXISTS trg_notifications_after_save ON public.notifications;
CREATE TRIGGER trg_notifications_after_save
  AFTER INSERT OR UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notifications_after_save();

-- ----------------------------------------------------------------------------
-- 7. RPC TẠO THÔNG BÁO RIÊNG HỌC SINH: PUBLIC.RPC_CREATE_INDIVIDUAL_NOTIFICATION
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_create_individual_notification(
  p_title TEXT,
  p_content TEXT,
  p_target_student_id UUID,
  p_priority TEXT DEFAULT 'normal',
  p_category TEXT DEFAULT 'general',
  p_linked_resource_type TEXT DEFAULT NULL,
  p_linked_resource_id UUID DEFAULT NULL,
  p_link_url TEXT DEFAULT NULL,
  p_publish_now BOOLEAN DEFAULT FALSE
) RETURNS JSONB AS $$
DECLARE
  v_caller RECORD;
  v_notification_id UUID;
  v_clean_title TEXT := trim(COALESCE(p_title, ''));
  v_clean_content TEXT := trim(COALESCE(p_content, ''));
  v_clean_link_url TEXT := trim(COALESCE(p_link_url, ''));
BEGIN
  IF v_clean_title = '' THEN
    RAISE EXCEPTION 'INVALID_TITLE: Title cannot be empty.';
  END IF;

  IF length(v_clean_title) > 200 THEN
    RAISE EXCEPTION 'INVALID_TITLE: Title exceeds 200 characters.';
  END IF;

  IF v_clean_content = '' THEN
    RAISE EXCEPTION 'INVALID_CONTENT: Content cannot be empty.';
  END IF;

  IF p_target_student_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TARGET: Target student ID must be provided.';
  END IF;

  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'INVALID_PRIORITY: Priority must be one of low, normal, high, urgent.';
  END IF;

  -- Kiểm tra category theo đúng CHECK constraint chk_notifications_category
  IF p_category NOT IN ('general', 'exercise', 'material', 'exam', 'system') THEN
    RAISE EXCEPTION 'INVALID_CATEGORY: Invalid notification category. Must be one of general, exercise, material, exam, system.';
  END IF;

  IF v_clean_link_url = '' THEN
    v_clean_link_url := NULL;
  END IF;

  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  IF v_caller.user_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only admins and teachers can create notifications.';
  END IF;

  -- 1. BƯỚC 1: LUÔN TẠO DRAFT TRƯỚC ĐỂ TUÂN THỦ NGUYÊN TẮC ZERO DIRECT PUBLISH
  INSERT INTO public.notifications (
    title,
    content,
    priority,
    category,
    target_type,
    target_student_id,
    linked_resource_type,
    linked_resource_id,
    link_url,
    is_published
  ) VALUES (
    v_clean_title,
    v_clean_content,
    p_priority,
    p_category,
    'individual',
    p_target_student_id,
    p_linked_resource_type,
    p_linked_resource_id,
    v_clean_link_url,
    FALSE
  ) RETURNING id INTO v_notification_id;

  -- 2. BƯỚC 2: NẾU YÊU CẦU XUẤT BẢN NGAY (p_publish_now = TRUE), THỰC HIỆN UPDATE SANG PUBLISHED
  -- Thao tác này kích hoạt đầy đủ trigger protect_lifecycle (Dual-Gate Validation tầng 2)
  -- và trigger after_save (tạo snapshot recipient an toàn)
  IF p_publish_now = TRUE THEN
    UPDATE public.notifications
    SET is_published = TRUE
    WHERE id = v_notification_id;
  END IF;

  RETURN jsonb_build_object(
    'notification_id', v_notification_id,
    'is_published', p_publish_now,
    'target_type', 'individual',
    'target_student_id', p_target_student_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_individual_notification(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_individual_notification(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. RPC TÌM KIẾM HỌC SINH MỤC TIÊU: PUBLIC.RPC_SEARCH_STUDENTS_FOR_NOTIFICATION
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_search_students_for_notification(
  p_search TEXT DEFAULT '',
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  student_code TEXT,
  class_name TEXT,
  grade_level INT
) AS $$
DECLARE
  v_caller RECORD;
  v_clean_search TEXT := trim(COALESCE(p_search, ''));
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  IF v_caller.user_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only admins and teachers can search students for notifications.';
  END IF;

  -- Nếu là Giáo viên: CHỈ ĐƯỢC TÌM THẤY học sinh thuộc các lớp mà giáo viên này đang trực tiếp phụ trách
  IF v_caller.user_role = 'teacher' THEN
    RETURN QUERY
    SELECT
      p.id AS student_id,
      p.full_name,
      p.student_code,
      c.name AS class_name,
      c.grade_level
    FROM public.class_members cm
    JOIN public.classes c ON c.id = cm.class_id
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE c.teacher_id = v_caller.user_id
      AND cm.is_active = TRUE
      AND p.role = 'student'
      AND p.is_disabled = FALSE
      AND (
        v_clean_search = '' OR
        p.full_name ILIKE '%' || v_clean_search || '%' OR
        p.student_code ILIKE '%' || v_clean_search || '%'
      )
    ORDER BY c.grade_level ASC, c.name ASC, p.full_name ASC
    LIMIT v_limit OFFSET v_offset;

  -- Nếu là Admin: Có quyền tìm kiếm học sinh trên phạm vi toàn trường
  ELSIF v_caller.user_role = 'admin' THEN
    RETURN QUERY
    SELECT
      p.id AS student_id,
      p.full_name,
      p.student_code,
      c.name AS class_name,
      c.grade_level
    FROM public.profiles p
    LEFT JOIN public.class_members cm ON cm.student_id = p.id AND cm.is_active = TRUE
    LEFT JOIN public.classes c ON c.id = cm.class_id
    WHERE p.role = 'student'
      AND p.is_disabled = FALSE
      AND (
        v_clean_search = '' OR
        p.full_name ILIKE '%' || v_clean_search || '%' OR
        p.student_code ILIKE '%' || v_clean_search || '%'
      )
    ORDER BY p.full_name ASC
    LIMIT v_limit OFFSET v_offset;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_search_students_for_notification(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_search_students_for_notification(TEXT, INT, INT) TO authenticated, service_role;
