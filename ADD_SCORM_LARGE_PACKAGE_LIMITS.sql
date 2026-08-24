-- ====================================================================
-- MIGRATION: ADD SCORM LARGE PACKAGE LIMITS (100MB) (IDEMPOTENT)
-- Mục đích: Nâng hạn mức lưu trữ (file_size_limit) lên 100MB (104857600 bytes)
-- cho cả 2 bucket 'learning-materials' và 'scorm-content'
-- QUY TẮC AN TOÀN:
-- 1. CHỈ thay đổi file_size_limit.
-- 2. KHÔNG thay đổi allowed_mime_types trên bất kỳ bucket nào.
-- 3. Yêu cầu bucket learning-materials phải có sẵn 'application/zip' (thuộc trách nhiệm của ADD_SCORM_STORAGE_HARDENING.sql).
-- ====================================================================

BEGIN;

-- 1. CẬP NHẬT BUCKET 'learning-materials' (FILE_SIZE_LIMIT = 100MB)
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

  -- Đảm bảo bucket ở trạng thái private
  IF v_bucket.public IS TRUE THEN
    RAISE EXCEPTION 'BẢO MẬT: Bucket "learning-materials" phải là PRIVATE (public = false)';
  END IF;

  -- Ràng buộc G7 MIME contract: allowed_mime_types không được NULL
  IF v_bucket.allowed_mime_types IS NULL THEN
    RAISE EXCEPTION 'BẢO MẬT: Bucket "learning-materials" có allowed_mime_types là NULL. Vui lòng áp dụng migration ADD_SCORM_STORAGE_HARDENING.sql trước.';
  END IF;

  -- Ràng buộc G7 MIME contract: application/zip bắt buộc phải tồn tại sẵn
  IF NOT ('application/zip' = ANY(v_bucket.allowed_mime_types)) THEN
    RAISE EXCEPTION 'BẢO MẬT: Bucket "learning-materials" thiếu MIME "application/zip". Vui lòng áp dụng migration ADD_SCORM_STORAGE_HARDENING.sql trước.';
  END IF;

  -- Chỉ cập nhật file_size_limit lên 100MB (104857600 bytes), bảo toàn tuyệt đối allowed_mime_types
  UPDATE storage.buckets
  SET file_size_limit = 104857600
  WHERE id = 'learning-materials';
END $$;

-- 2. CẬP NHẬT BUCKET 'scorm-content' (FILE_SIZE_LIMIT = 100MB)
DO $$
DECLARE
  v_bucket RECORD;
BEGIN
  -- Lấy thông tin bucket scorm-content
  SELECT id, public, file_size_limit, allowed_mime_types
  INTO v_bucket
  FROM storage.buckets
  WHERE id = 'scorm-content';

  -- Báo lỗi rõ ràng nếu bucket chưa tồn tại
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bucket "scorm-content" không tồn tại trong storage.buckets';
  END IF;

  -- Đảm bảo bucket ở trạng thái private
  IF v_bucket.public IS TRUE THEN
    RAISE EXCEPTION 'BẢO MẬT: Bucket "scorm-content" phải là PRIVATE (public = false)';
  END IF;

  -- Cập nhật file_size_limit lên 100MB (104857600 bytes), bảo toàn tuyệt đối allowed_mime_types và public
  UPDATE storage.buckets
  SET file_size_limit = 104857600
  WHERE id = 'scorm-content';
END $$;

COMMIT;
