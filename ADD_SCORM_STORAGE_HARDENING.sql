-- ====================================================================
-- MIGRATION: ADD SCORM STORAGE HARDENING (IDEMPOTENT)
-- Mục đích: Đồng bộ các bản vá Storage cho SCORM G6 vào mã nguồn
-- 1. Cho phép MIME type 'application/zip' trong bucket 'learning-materials'
-- 2. Cập nhật RLS INSERT/DELETE cho phép giáo viên tải/xóa trong scorm-zips/<uid>/...
-- ====================================================================

BEGIN;

-- 1. CẬP NHẬT ALLOWED_MIME_TYPES CHO BUCKET 'learning-materials' (IDEMPOTENT)
DO $$
DECLARE
  v_bucket RECORD;
BEGIN
  -- Lấy thông tin bucket learning-materials
  SELECT id, public, file_size_limit, allowed_mime_types
  INTO v_bucket
  FROM storage.buckets
  WHERE id = 'learning-materials';

  -- Báo lỗi rõ ràng nếu bucket chưa tồn tại
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bucket "learning-materials" không tồn tại trong storage.buckets';
  END IF;

  -- Nếu allowed_mime_types IS NULL -> giữ nguyên NULL
  -- Nếu allowed_mime_types là mảng và chưa có 'application/zip' -> thêm vào cuối
  -- Nếu đã có 'application/zip' -> giữ nguyên (no-op)
  -- Không thay đổi public hoặc file_size_limit
  IF v_bucket.allowed_mime_types IS NOT NULL THEN
    IF NOT ('application/zip' = ANY(v_bucket.allowed_mime_types)) THEN
      UPDATE storage.buckets
      SET allowed_mime_types = array_append(v_bucket.allowed_mime_types, 'application/zip')
      WHERE id = 'learning-materials';
    END IF;
  END IF;
END $$;

-- 2. CẬP NHẬT STORAGE RLS INSERT POLICY
-- Cho phép: Admin toàn quyền HOẶC Giáo viên tải lên <auth.uid()>/... HOẶC scorm-zips/<auth.uid()>/...
DROP POLICY IF EXISTS "learning_materials_storage_insert" ON storage.objects;
CREATE POLICY "learning_materials_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'learning-materials'
  AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
      AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR (
          (storage.foldername(name))[1] = 'scorm-zips'
          AND (storage.foldername(name))[2] = auth.uid()::text
        )
      )
    )
  )
);

-- 3. CẬP NHẬT STORAGE RLS DELETE POLICY
-- Cho phép: Admin toàn quyền HOẶC Giáo viên xóa file trong <auth.uid()>/... HOẶC scorm-zips/<auth.uid()>/...
DROP POLICY IF EXISTS "learning_materials_storage_delete" ON storage.objects;
CREATE POLICY "learning_materials_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'learning-materials'
  AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
      AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR (
          (storage.foldername(name))[1] = 'scorm-zips'
          AND (storage.foldername(name))[2] = auth.uid()::text
        )
      )
    )
  )
);

COMMIT;
