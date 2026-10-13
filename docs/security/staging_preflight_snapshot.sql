-- ============================================================================
-- [STAGING READ-ONLY PREFLIGHT AUDIT & SNAPSHOT SCRIPT]
-- Dự án: Supabase Staging (rcqgxmcqolxbrahhyxji)
-- Mục đích: Kiểm định chỉ đọc (READ-ONLY) trước khi áp dụng migration
--           20261013120000_auth_role_trust_hardening.sql.
-- TUYỆT ĐỐI KHÔNG GHI DỮ LIỆU, KHÔNG SỬA ĐỔI SCHEMA, KHÔNG TẠO USER.
-- ============================================================================

-- BƯỚC 1: XÁC MINH QUYỀN CỦA TÀI KHOẢN THỰC THI (MIGRATION_PERMISSION_READY)
SELECT 
    CURRENT_USER AS executing_user,
    SESSION_USER AS session_user,
    pg_has_role(CURRENT_USER, 'postgres', 'MEMBER') AS is_postgres_member,
    pg_has_role(CURRENT_USER, 'supabase_admin', 'MEMBER') AS is_supabase_admin_member;

-- BƯỚC 2: SNAPSHOT TRIGGER auth.users.on_auth_user_created
-- (Xác minh TỒN TẠI, ENABLED, và TRỎ ĐÚNG public.handle_new_user)
SELECT 
    t.oid AS trigger_oid,
    t.tgname AS trigger_name,
    tbl_ns.nspname AS table_schema,
    tbl.relname AS table_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED (Origin)'
        WHEN 'D' THEN 'DISABLED'
        WHEN 'R' THEN 'REPLICA ONLY'
        WHEN 'A' THEN 'ALWAYS'
        ELSE t.tgenabled::text
    END AS trigger_status,
    p_ns.nspname AS target_function_schema,
    p.proname AS target_function_name,
    pg_get_triggerdef(t.oid, true) AS full_trigger_definition
FROM pg_trigger t
JOIN pg_class tbl ON tbl.oid = t.tgrelid
JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace p_ns ON p_ns.oid = p.pronamespace
WHERE tbl_ns.nspname = 'auth'
  AND tbl.relname = 'users'
  AND t.tgname = 'on_auth_user_created';

-- BƯỚC 3: SNAPSHOT HÀM public.handle_new_user()
-- (Xác minh OWNER, SECURITY DEFINER, và ĐỊNH NGHĨA NGUYÊN BẢN TRƯỚC KHI VÁ)
SELECT 
    p.oid AS function_oid,
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    r.rolname AS owner_name,
    p.prosecdef AS is_security_definer,
    pg_get_functiondef(p.oid) AS original_function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname = 'handle_new_user';

-- BƯỚC 4: KIỂM ĐỊNH TƯƠNG THÍCH SCHEMA TRÊN public.profiles (11 CỘT ĐƯỢC DÙNG)
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
  AND column_name IN (
    'id', 
    'email', 
    'full_name', 
    'role', 
    'avatar_url', 
    'grade_level', 
    'total_stars', 
    'total_coins', 
    'is_disabled', 
    'created_at', 
    'updated_at'
  )
ORDER BY ordinal_position;

-- BƯỚC 5: KIỂM TRA RÀNG BUỘC (CONSTRAINTS) TRÊN BẢNG public.profiles (PK, FK tới auth.users)
SELECT 
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'profiles';
