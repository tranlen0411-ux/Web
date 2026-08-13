BEGIN;

-- 1. SCHEMA MẬT APP_PRIVATE VÀ CÁC HÀM HELPER NỘI BỘ
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE OR REPLACE FUNCTION app_private.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION app_private.is_teacher()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'teacher');
$$;

CREATE OR REPLACE FUNCTION app_private.teacher_owns_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION app_private.student_in_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION app_private.teacher_manages_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classes c
    JOIN public.class_members cm ON c.id = cm.class_id
    WHERE c.teacher_id = (SELECT auth.uid()) AND cm.student_id = p_student_id
  );
$$;

-- HÀM NỘI BỘ CỘT SAO VÀ XU
CREATE OR REPLACE FUNCTION app_private.apply_student_rewards(p_student_id UUID, p_stars INT, p_coins INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.profiles
  SET total_stars = COALESCE(total_stars, 0) + GREATEST(0, p_stars),
      total_coins = COALESCE(total_coins, 0) + GREATEST(0, p_coins),
      updated_at = NOW()
  WHERE id = p_student_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.is_teacher() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.teacher_owns_class(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.student_in_class(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.teacher_manages_student(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.apply_student_rewards(UUID, INT, INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_teacher() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.teacher_owns_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.student_in_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.teacher_manages_student(UUID) TO authenticated;

-- BỔ SUNG CỘT IS_DISABLED CHO PUBLIC.PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- 2. PHÂN QUYỀN CẤP BẢNG & CẤP CỘT (KHÔNG CẤP INSERT CHO AUTHENTICATED/ANON)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.profiles FROM anon;
REVOKE ALL PRIVILEGES ON public.profiles FROM authenticated;

GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, updated_at) ON public.profiles TO authenticated;

-- 3. TRIGGER TỰ ĐỘNG TẠO HỒ SƠ HỌC SINH AN TOÀN KHI ĐĂNG KÝ
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_full_name TEXT;
  v_avatar_url TEXT;
  v_grade_level INT;
  v_meta_role TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1));
  v_avatar_url := COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/bottts/svg?seed=' || NEW.id);
  v_meta_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');

  BEGIN
    v_grade_level := (NEW.raw_user_meta_data->>'grade_level')::INT;
  EXCEPTION WHEN OTHERS THEN
    v_grade_level := 1;
  END;

  IF v_grade_level IS NULL OR v_grade_level < 1 OR v_grade_level > 12 THEN
    v_grade_level := 1;
  END IF;

  IF v_meta_role NOT IN ('student', 'teacher', 'admin') THEN
    v_meta_role := 'student';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, avatar_url, grade_level, total_stars, total_coins, is_disabled, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_meta_role,
    v_avatar_url,
    v_grade_level,
    0,
    0,
    FALSE,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. UNIQUE INDEX CHỐNG THƯỞNG TRÙNG BÀI TẬP
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_assignment_progress 
ON public.student_progress (student_id, assignment_id) 
WHERE assignment_id IS NOT NULL;

-- 5. RPC ADMIN CẬP NHẬT HOẶC NÂNG QUYỀN TÀI KHOẢN AN TOÀN
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_target_user_id UUID,
  p_full_name TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_grade_level INT DEFAULT NULL,
  p_total_stars INT DEFAULT NULL,
  p_total_coins INT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền thực hiện.');
  END IF;

  IF p_role IS NOT NULL AND p_role NOT IN ('student', 'teacher', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vai trò (role) không hợp lệ. Chỉ chấp nhận: student, teacher, admin.');
  END IF;

  IF p_grade_level IS NOT NULL AND (p_grade_level < 1 OR p_grade_level > 12) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Khối lớp (grade_level) phải từ 1 đến 12.');
  END IF;

  IF p_total_stars IS NOT NULL AND p_total_stars < 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tổng số Sao (total_stars) không được âm.');
  END IF;

  IF p_total_coins IS NOT NULL AND p_total_coins < 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tổng số Xu (total_coins) không được âm.');
  END IF;

  UPDATE public.profiles
  SET full_name = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
      role = COALESCE(p_role, role),
      grade_level = COALESCE(p_grade_level, grade_level),
      total_stars = COALESCE(p_total_stars, total_stars),
      total_coins = COALESCE(p_total_coins, total_coins),
      updated_at = NOW()
  WHERE id = p_target_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Cập nhật tài khoản thành công.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, INT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, INT, INT, INT) TO authenticated;

-- 5B. RPC ADMIN TẠO TÀI KHOẢN MỚI (AUTH USER + PROFILE)
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_grade_level INT DEFAULT 1
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_new_user_id UUID;
  v_clean_email TEXT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền tạo tài khoản.');
  END IF;

  v_clean_email := LOWER(TRIM(p_email));
  IF v_clean_email IS NULL OR v_clean_email = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Email không được để trống.');
  END IF;

  IF p_password IS NULL OR LENGTH(p_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mật khẩu phải từ 6 ký tự trở lên.');
  END IF;

  IF p_role NOT IN ('student', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vai trò không hợp lệ (Chỉ tạo được Học sinh hoặc Giáo viên).');
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_clean_email) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Email này đã tồn tại trong hệ thống.');
  END IF;

  v_new_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at
  ) VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_clean_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    NOW(),
    jsonb_build_object('full_name', TRIM(p_full_name), 'role', p_role, 'grade_level', p_grade_level),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated',
    'authenticated',
    NOW(),
    NOW()
  );

  INSERT INTO public.profiles (id, email, full_name, role, grade_level, total_stars, total_coins, is_disabled, created_at, updated_at)
  VALUES (
    v_new_user_id, v_clean_email, TRIM(p_full_name), p_role, p_grade_level, 0, 0, FALSE, NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    grade_level = EXCLUDED.grade_level,
    updated_at = NOW();

  RETURN jsonb_build_object('success', true, 'message', 'Tạo tài khoản thành công!', 'user_id', v_new_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, INT) TO authenticated;

-- 5C. RPC ADMIN KHÓA / MỞ KHÓA TÀI KHOẢN
CREATE OR REPLACE FUNCTION public.admin_toggle_user_status(
  p_target_user_id UUID,
  p_is_disabled BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không thể tự khóa tài khoản đang đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền thực hiện.');
  END IF;

  UPDATE public.profiles
  SET is_disabled = p_is_disabled,
      updated_at = NOW()
  WHERE id = p_target_user_id;

  IF p_is_disabled THEN
    UPDATE auth.users SET banned_until = '2099-01-01 00:00:00+00' WHERE id = p_target_user_id;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = p_target_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', CASE WHEN p_is_disabled THEN 'Đã khóa tài khoản thành công.' ELSE 'Đã mở khóa tài khoản thành công.' END);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_toggle_user_status(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_user_status(UUID, BOOLEAN) TO authenticated;

-- 5D. RPC ADMIN XÓA TÀI KHOẢN AN TOÀN (CÓ KIỂM TRA LỚP HỌC DO GIÁO VIÊN QUẢN LÝ)
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_target_user_id UUID,
  p_reassign_teacher_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_role TEXT;
  v_owned_classes_count INT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không thể tự xóa tài khoản đang đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền thực hiện.');
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_target_user_id;
  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tài khoản không tồn tại.');
  END IF;

  IF v_target_role = 'teacher' THEN
    SELECT COUNT(*) INTO v_owned_classes_count FROM public.classes WHERE teacher_id = p_target_user_id;
    IF v_owned_classes_count > 0 THEN
      IF p_reassign_teacher_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false, 
          'message', format('Giáo viên này đang quản lý %s lớp học. Hãy chọn Giáo viên mới để chuyển giao lớp hoặc thực hiện Khóa tài khoản.', v_owned_classes_count),
          'requires_reassign', true,
          'owned_classes_count', v_owned_classes_count
        );
      ELSE
        UPDATE public.classes SET teacher_id = p_reassign_teacher_id WHERE teacher_id = p_target_user_id;
      END IF;
    END IF;
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Đã xóa tài khoản thành công.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID) TO authenticated;

-- 6. RPC GIA NHẬP LỚP HỌC
CREATE OR REPLACE FUNCTION public.join_class_by_code(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_class RECORD;
  v_student_id UUID;
  v_member_id UUID;
BEGIN
  v_student_id := (SELECT auth.uid());
  IF v_student_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_student_id AND role = 'student') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chỉ Học sinh mới được gia nhập lớp.');
  END IF;

  SELECT id, name INTO v_class FROM public.classes WHERE UPPER(code) = UPPER(TRIM(p_code));
  IF v_class.id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Mã lớp không tồn tại.'); END IF;

  IF EXISTS (SELECT 1 FROM public.class_members WHERE class_id = v_class.id AND student_id = v_student_id) THEN
    RETURN jsonb_build_object('success', true, 'message', format('Bé đã gia nhập lớp %s rồi!', v_class.name), 'already_joined', true);
  END IF;

  INSERT INTO public.class_members (class_id, student_id) VALUES (v_class.id, v_student_id) RETURNING id INTO v_member_id;
  RETURN jsonb_build_object('success', true, 'message', format('Gia nhập lớp %s thành công!', v_class.name), 'class_name', v_class.name);
END;
$$;

REVOKE ALL ON FUNCTION public.join_class_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_class_by_code(TEXT) TO authenticated;

-- 7. RPC COMPLETE GAME AND AWARD SERVER-SIDE (KIỂM TRA P_GAME_ID TỒN TẠI TRƯỚC KHI ADMIN PREVIEW)
CREATE OR REPLACE FUNCTION public.complete_game_and_award(
  p_game_id UUID,
  p_assignment_id UUID DEFAULT NULL,
  p_score INT DEFAULT 100,
  p_completion_time_seconds INT DEFAULT 60
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_student_id UUID;
  v_role TEXT;
  v_assignment RECORD;
  v_reward_stars INT := 10;
  v_reward_coins INT := 5;
  v_progress_id UUID;
  v_lock_obtained BOOLEAN;
BEGIN
  v_student_id := (SELECT auth.uid());
  IF v_student_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.games WHERE id = p_game_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trò chơi không tồn tại.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  
  IF v_role IS DISTINCT FROM 'student' THEN
    IF v_role = 'admin' THEN
      RETURN jsonb_build_object('success', true, 'message', 'Quản trị viên đang xem thử trò chơi (Không tích điểm).', 'is_admin_preview', true);
    ELSE
      RETURN jsonb_build_object('success', false, 'message', 'Chỉ tài khoản Học sinh mới được tích điểm.');
    END IF;
  END IF;

  v_lock_obtained := pg_try_advisory_xact_lock(hashtext(v_student_id::text || '_' || p_game_id::text));
  IF NOT v_lock_obtained THEN
    RETURN jsonb_build_object('success', false, 'message', 'Hệ thống đang xử lý, vui lòng không bấm liên tục!');
  END IF;

  IF p_assignment_id IS NOT NULL THEN
    SELECT a.id, a.game_id, a.class_id, COALESCE(a.reward_stars, 10) AS reward_stars
    INTO v_assignment
    FROM public.assignments a
    JOIN public.class_members cm ON a.class_id = cm.class_id
    WHERE a.id = p_assignment_id AND a.game_id = p_game_id AND cm.student_id = v_student_id;

    IF v_assignment.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bài tập không hợp lệ hoặc bé không thuộc lớp.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.student_progress WHERE student_id = v_student_id AND assignment_id = p_assignment_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bé đã hoàn thành bài tập này trước đó rồi!', 'already_completed', true);
    END IF;

    v_reward_stars := v_assignment.reward_stars;
    v_reward_coins := GREATEST(1, FLOOR(v_reward_stars / 2));
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.student_progress 
      WHERE student_id = v_student_id AND game_id = p_game_id AND completed_at > NOW() - INTERVAL '30 seconds'
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bé vừa hoàn thành game này. Hãy đợi 30s nhé!');
    END IF;

    IF p_score >= 80 THEN v_reward_stars := 15; v_reward_coins := 7;
    ELSIF p_score >= 50 THEN v_reward_stars := 10; v_reward_coins := 5;
    ELSE v_reward_stars := 5; v_reward_coins := 2;
    END IF;
  END IF;

  INSERT INTO public.student_progress (
    game_id, assignment_id, student_id, status, score, stars_earned, completion_time_seconds, completed_at
  ) VALUES (
    p_game_id, p_assignment_id, v_student_id, 'completed', GREATEST(0, LEAST(100, p_score)), v_reward_stars, GREATEST(5, p_completion_time_seconds), NOW()
  )
  ON CONFLICT (student_id, assignment_id) WHERE assignment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_progress_id;

  IF v_progress_id IS NULL AND p_assignment_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bé đã hoàn thành bài tập này rồi!', 'already_completed', true);
  END IF;

  PERFORM app_private.apply_student_rewards(v_student_id, v_reward_stars, v_reward_coins);
  UPDATE public.games SET play_count = COALESCE(play_count, 0) + 1 WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true, 
    'message', format('Xuất sắc! Bé nhận %s Sao và %s Xu!', v_reward_stars, v_reward_coins),
    'stars_earned', v_reward_stars, 'coins_earned', v_reward_coins
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_game_and_award(UUID, UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_game_and_award(UUID, UUID, INT, INT) TO authenticated;

-- 8. TRIGGER BẢO VỆ CỘT ROLE VÀ GRADE_LEVEL
CREATE OR REPLACE FUNCTION public.prevent_profile_tampering()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role AND NOT app_private.is_admin() THEN NEW.role := OLD.role; END IF;
  IF OLD.grade_level IS DISTINCT FROM NEW.grade_level AND NOT app_private.is_admin() THEN NEW.grade_level := OLD.grade_level; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_tampering ON public.profiles;
CREATE TRIGGER trg_prevent_profile_tampering
  BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tampering();

-- 9. BẬT RLS VÀ TẠO POLICY CHO 9 BẢNG
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_badges ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
DROP POLICY IF EXISTS "Public profiles read" ON public.profiles;
DROP POLICY IF EXISTS "Users update own or admin update all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (id = (SELECT auth.uid()) OR app_private.is_admin() OR app_private.teacher_manages_student(id));
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (id = (SELECT auth.uid()) OR app_private.is_admin());

-- CLASSES POLICIES
DROP POLICY IF EXISTS "Anyone read classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers and admins create classes" ON public.classes;
DROP POLICY IF EXISTS "classes_select" ON public.classes;
DROP POLICY IF EXISTS "classes_insert" ON public.classes;
DROP POLICY IF EXISTS "classes_update" ON public.classes;
DROP POLICY IF EXISTS "classes_delete" ON public.classes;
CREATE POLICY "classes_select" ON public.classes FOR SELECT USING (teacher_id = (SELECT auth.uid()) OR app_private.is_admin() OR app_private.student_in_class(id));
CREATE POLICY "classes_insert" ON public.classes FOR INSERT WITH CHECK ((app_private.is_teacher() AND teacher_id = (SELECT auth.uid())) OR app_private.is_admin());
CREATE POLICY "classes_update" ON public.classes FOR UPDATE USING (teacher_id = (SELECT auth.uid()) OR app_private.is_admin()) WITH CHECK (teacher_id = (SELECT auth.uid()) OR app_private.is_admin());
CREATE POLICY "classes_delete" ON public.classes FOR DELETE USING (teacher_id = (SELECT auth.uid()) OR app_private.is_admin());

-- CLASS_MEMBERS POLICIES
DROP POLICY IF EXISTS "Anyone read class members" ON public.class_members;
DROP POLICY IF EXISTS "class_members_select" ON public.class_members;
DROP POLICY IF EXISTS "class_members_insert" ON public.class_members;
DROP POLICY IF EXISTS "class_members_delete" ON public.class_members;
CREATE POLICY "class_members_select" ON public.class_members FOR SELECT USING (student_id = (SELECT auth.uid()) OR app_private.teacher_owns_class(class_id) OR app_private.is_admin());
CREATE POLICY "class_members_insert" ON public.class_members FOR INSERT WITH CHECK (app_private.teacher_owns_class(class_id) OR app_private.is_admin());
CREATE POLICY "class_members_delete" ON public.class_members FOR DELETE USING (student_id = (SELECT auth.uid()) OR app_private.teacher_owns_class(class_id) OR app_private.is_admin());

-- GAMES POLICIES
DROP POLICY IF EXISTS "Anyone read games" ON public.games;
DROP POLICY IF EXISTS "Teachers and admins manage games" ON public.games;
DROP POLICY IF EXISTS "games_select" ON public.games;
DROP POLICY IF EXISTS "games_insert" ON public.games;
DROP POLICY IF EXISTS "games_update" ON public.games;
DROP POLICY IF EXISTS "games_delete" ON public.games;
CREATE POLICY "games_select" ON public.games FOR SELECT USING (true);
CREATE POLICY "games_insert" ON public.games FOR INSERT WITH CHECK (
  (app_private.is_teacher() AND author_id = (SELECT auth.uid())) OR app_private.is_admin()
);
CREATE POLICY "games_update" ON public.games FOR UPDATE USING (
  (app_private.is_teacher() AND author_id = (SELECT auth.uid())) OR app_private.is_admin()
) WITH CHECK (
  (app_private.is_teacher() AND author_id = (SELECT auth.uid())) OR app_private.is_admin()
);
CREATE POLICY "games_delete" ON public.games FOR DELETE USING (
  (app_private.is_teacher() AND author_id = (SELECT auth.uid())) OR app_private.is_admin()
);

-- ASSIGNMENTS POLICIES
DROP POLICY IF EXISTS "Anyone read assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teachers and admins create assignments" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
DROP POLICY IF EXISTS "assignments_insert" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete" ON public.assignments;
CREATE POLICY "assignments_select" ON public.assignments FOR SELECT USING (app_private.teacher_owns_class(class_id) OR app_private.student_in_class(class_id) OR app_private.is_admin());
CREATE POLICY "assignments_insert" ON public.assignments FOR INSERT WITH CHECK (app_private.teacher_owns_class(class_id) OR app_private.is_admin());
CREATE POLICY "assignments_update" ON public.assignments FOR UPDATE USING (app_private.teacher_owns_class(class_id) OR app_private.is_admin()) WITH CHECK (app_private.teacher_owns_class(class_id) OR app_private.is_admin());
CREATE POLICY "assignments_delete" ON public.assignments FOR DELETE USING (app_private.teacher_owns_class(class_id) OR app_private.is_admin());

-- STUDENT_PROGRESS POLICIES
DROP POLICY IF EXISTS "Read progress policy" ON public.student_progress;
DROP POLICY IF EXISTS "Student insert progress" ON public.student_progress;
DROP POLICY IF EXISTS "progress_select" ON public.student_progress;
DROP POLICY IF EXISTS "progress_insert" ON public.student_progress;
DROP POLICY IF EXISTS "progress_update" ON public.student_progress;
CREATE POLICY "progress_select" ON public.student_progress FOR SELECT USING (student_id = (SELECT auth.uid()) OR app_private.teacher_manages_student(student_id) OR app_private.is_admin());
CREATE POLICY "progress_insert" ON public.student_progress FOR INSERT WITH CHECK (app_private.is_admin());
CREATE POLICY "progress_update" ON public.student_progress FOR UPDATE USING (app_private.is_admin()) WITH CHECK (app_private.is_admin());

-- STUDENT_BADGES POLICIES
DROP POLICY IF EXISTS "Public student badges read" ON public.student_badges;
DROP POLICY IF EXISTS "Student insert badges" ON public.student_badges;
DROP POLICY IF EXISTS "student_badges_select" ON public.student_badges;
DROP POLICY IF EXISTS "student_badges_insert" ON public.student_badges;
CREATE POLICY "student_badges_select" ON public.student_badges FOR SELECT USING (student_id = (SELECT auth.uid()) OR app_private.teacher_manages_student(student_id) OR app_private.is_admin());
CREATE POLICY "student_badges_insert" ON public.student_badges FOR INSERT WITH CHECK (app_private.teacher_manages_student(student_id) OR app_private.is_admin());

-- CATEGORIES & BADGES POLICIES
DROP POLICY IF EXISTS "Public categories read" ON public.categories;
DROP POLICY IF EXISTS "Public badges read" ON public.badges;
DROP POLICY IF EXISTS "categories_select" ON public.categories;
DROP POLICY IF EXISTS "badges_select" ON public.badges;
CREATE POLICY "categories_select" ON public.categories FOR SELECT USING (true);
CREATE POLICY "badges_select" ON public.badges FOR SELECT USING (true);

COMMIT;
