-- ============================================================================
-- TEST SQL SUITE: academic_submission_image_annotations_security.sql
-- KỊCH BẢN KIỂM TRA BẢO MẬT & RLS / BOLA CHO HỆ THỐNG ANNOTATION VÀ ATTACHMENT
-- ============================================================================

-- 1. Test cấu trúc bảng
SELECT count(*) = 1 AS attachments_table_exists
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'academic_submission_attachments';

SELECT count(*) = 1 AS annotations_table_exists
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'academic_submission_annotation_versions';

-- 2. Test kích hoạt RLS (Row Level Security) & FORCE RLS
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls
FROM pg_class
WHERE relname IN ('academic_submission_attachments', 'academic_submission_annotation_versions');

-- 3. Xác minh chính sách RLS SELECT của annotation_versions KHÔNG chứa teacher_id = auth.uid() (Thu hồi quyền giáo viên cũ)
SELECT polname, polcmd, polqual
FROM pg_policy
WHERE polname = 'annotation_versions_select';

-- 4. Test RPCs tồn tại với SECURITY DEFINER và search_path rỗng
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE proname IN (
  'prepare_academic_submission_attachment',
  'finalize_academic_submission_attachment',
  'get_academic_submission_grading_workspace',
  'save_academic_submission_annotation_draft',
  'finalize_academic_submission_grading_with_annotations',
  'get_student_graded_submission'
) AND pronamespace = 'public'::regnamespace;

-- 5. Xác minh Storage policies cho exercise-submissions (Đảm bảo chỉ có 1 INSERT policy duy nhất)
SELECT
  polname,
  polcmd,
  polpermissive,
  polqual,
  polwithcheck
FROM pg_policy
WHERE polrelid = 'storage.objects'::regclass
  AND (polname LIKE '%Exercise submissions%' OR polname LIKE '%exercise%')
ORDER BY polcmd, polname;

-- 6. Xác nhận không còn policy INSERT thừa gây permissive broadening
SELECT count(*) = 1 AS single_insert_policy_enforced
FROM pg_policy
WHERE polrelid = 'storage.objects'::regclass
  AND polcmd = 'a'
  AND (polname LIKE '%Exercise submissions%' OR polname LIKE '%exercise%');
