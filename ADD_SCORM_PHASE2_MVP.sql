-- ====================================================================
-- MIGRATION: ADD SCORM PHASE 2A MVP (FINAL SECURITY HARDENED)
-- Hỗ trợ học liệu chuẩn SCORM 1.2 & SCORM 2004
-- Đồng bộ 100% với Material Visibility Phase 1 (class_members & learning_material_shares)
-- Layout Storage: scorm-content/<user-id>/<package-id>/...
-- ====================================================================

BEGIN;

-- 1. MỞ RỘNG RÀNG BUỘC FILE_TYPE TRÊN LEARNING_MATERIALS CHO PHÉP 'scorm' (IDEMPOTENT)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'learning_materials_file_type_check' 
      AND conrelid = 'public.learning_materials'::regclass
  ) THEN
    ALTER TABLE public.learning_materials DROP CONSTRAINT learning_materials_file_type_check;
  END IF;

  ALTER TABLE public.learning_materials 
    ADD CONSTRAINT learning_materials_file_type_check 
    CHECK (file_type IN ('pdf', 'word', 'powerpoint', 'image', 'video', 'link', 'scorm'));
END $$;

-- 2. TẠO BẢNG PUBLIC.SCORM_PACKAGES
CREATE TABLE IF NOT EXISTS public.scorm_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID UNIQUE NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
  package_version TEXT NOT NULL DEFAULT '1.0',
  scorm_version TEXT NOT NULL CHECK (scorm_version IN ('1.2', '2004')),
  manifest_path TEXT NOT NULL DEFAULT 'imsmanifest.xml',
  launch_path TEXT NOT NULL,
  content_root TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  original_zip_path TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ràng buộc trạng thái package (IDEMPOTENT)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'scorm_packages_status_check' 
      AND conrelid = 'public.scorm_packages'::regclass
  ) THEN
    ALTER TABLE public.scorm_packages DROP CONSTRAINT scorm_packages_status_check;
  END IF;

  ALTER TABLE public.scorm_packages 
    ADD CONSTRAINT scorm_packages_status_check 
    CHECK (status IN ('processing', 'ready', 'failed'));
END $$;

-- Tạo Index tăng tốc truy vấn
CREATE INDEX IF NOT EXISTS idx_scorm_packages_material_id ON public.scorm_packages(material_id);
CREATE INDEX IF NOT EXISTS idx_scorm_packages_created_by ON public.scorm_packages(created_by);
CREATE INDEX IF NOT EXISTS idx_scorm_packages_content_root ON public.scorm_packages(content_root);

-- 3. TRIGGER SECURITY DEFINER ĐẢM BẢO TÍNH NHẤT QUÁN OWNER
-- (scorm_packages.created_by == learning_materials.created_by)
CREATE OR REPLACE FUNCTION public.sync_scorm_package_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_material_owner UUID;
BEGIN
  SELECT created_by INTO v_material_owner
  FROM public.learning_materials
  WHERE id = NEW.material_id;

  IF v_material_owner IS NULL THEN
    RAISE EXCEPTION 'Tài liệu học tập liên kết không tồn tại.';
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := v_material_owner;
  ELSIF NEW.created_by <> v_material_owner THEN
    RAISE EXCEPTION 'scorm_packages.created_by (%) phải trùng khớp với created_by của learning_materials (%).', NEW.created_by, v_material_owner;
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

-- Thu hồi quyền EXECUTE trực tiếp từ PUBLIC (Trigger function không cần gọi trực tiếp)
REVOKE ALL ON FUNCTION public.sync_scorm_package_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_scorm_package_owner ON public.scorm_packages;
CREATE TRIGGER trg_sync_scorm_package_owner
  BEFORE INSERT OR UPDATE OF material_id, created_by ON public.scorm_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_scorm_package_owner();

-- 4. BẬT ROW LEVEL SECURITY (RLS) TRÊN BẢNG SCORM_PACKAGES
ALTER TABLE public.scorm_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scorm_packages_admin_all" ON public.scorm_packages;
DROP POLICY IF EXISTS "scorm_packages_teacher_owner" ON public.scorm_packages;
DROP POLICY IF EXISTS "scorm_packages_student_select" ON public.scorm_packages;

-- Policy 1: Admin toàn quyền quản lý mọi scorm_packages (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "scorm_packages_admin_all"
ON public.scorm_packages
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- Policy 2: Teacher có toàn quyền trên scorm_packages của bài học do mình tạo (kể cả processing, ready, failed)
CREATE POLICY "scorm_packages_teacher_owner"
ON public.scorm_packages
FOR ALL
TO authenticated
USING (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.learning_materials lm
    WHERE lm.id = scorm_packages.material_id AND lm.created_by = auth.uid()
  )
)
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.learning_materials lm
    WHERE lm.id = scorm_packages.material_id AND lm.created_by = auth.uid()
  )
);

-- Policy 3: Học sinh chỉ SELECT metadata nếu bài giảng được phép xem theo Material Visibility Phase 1 VÀ status = 'ready'
CREATE POLICY "scorm_packages_student_select"
ON public.scorm_packages
FOR SELECT
TO authenticated
USING (
  status = 'ready'
  AND EXISTS (
    SELECT 1 FROM public.learning_materials lm
    WHERE lm.id = scorm_packages.material_id
      AND (
        -- Bài toàn trường
        lm.visibility = 'school'
        -- Bài công khai
        OR lm.visibility = 'public'
        -- Bài của lớp học sinh đang học (Khớp 100% Phase 1 contract qua class_members)
        OR (
          lm.visibility = 'class' AND (
            EXISTS (
              SELECT 1 FROM public.class_members cm
              WHERE cm.class_id = lm.class_id AND cm.student_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.classes c
              WHERE c.id = lm.class_id AND c.teacher_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.learning_material_shares lms
              JOIN public.class_members cm ON cm.class_id = lms.class_id
              WHERE lms.material_id = lm.id AND cm.student_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.learning_material_shares lms
              JOIN public.classes c ON c.id = lms.class_id
              WHERE lms.material_id = lm.id AND c.teacher_id = auth.uid()
            )
          )
        )
      )
  )
);

-- 5. KHỞI TẠO BUCKET STORAGE 'scorm-content' (100% PRIVATE, NO SILENT MUTATION)
DO $$
DECLARE
  v_bucket RECORD;
BEGIN
  SELECT id, public, file_size_limit, allowed_mime_types
  INTO v_bucket
  FROM storage.buckets
  WHERE id = 'scorm-content';

  IF NOT FOUND THEN
    -- A. Bucket chưa tồn tại: Tạo mới bucket private với cấu hình chuẩn
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'scorm-content',
      'scorm-content',
      false,
      31457280, -- 30MB max single file
      NULL
    );
  ELSE
    -- B. Bucket đã tồn tại: Tuyệt đối KHÔNG silent mutate cấu hình
    -- B1. Bắt buộc phải là Private (public = false)
    IF v_bucket.public IS TRUE THEN
      RAISE EXCEPTION 'BẢO MẬT: Bucket storage "scorm-content" hiện tại đang ở chế độ PUBLIC. Yêu cầu cấu hình PRIVATE để bảo vệ SCORM assets.';
    END IF;

    -- B2. file_size_limit phải đúng cấu hình mong đợi (31457280 bytes = 30MB)
    IF v_bucket.file_size_limit IS DISTINCT FROM 31457280 THEN
      RAISE EXCEPTION 'XUNG ĐỘT CẤU HÌNH: Bucket "scorm-content" đã tồn tại với file_size_limit = % (kỳ vọng 31457280). Vui lòng kiểm tra và đồng bộ cấu hình trước khi chạy migration.', v_bucket.file_size_limit;
    END IF;

    -- B3. allowed_mime_types phải là NULL
    IF v_bucket.allowed_mime_types IS NOT NULL THEN
      RAISE EXCEPTION 'XUNG ĐỘT CẤU HÌNH: Bucket "scorm-content" đã tồn tại với allowed_mime_types = % (kỳ vọng NULL). Vui lòng kiểm tra cấu hình trước khi chạy migration.', v_bucket.allowed_mime_types;
    END IF;
  END IF;
END $$;


-- 6. RLS POLICIES CHO STORAGE.OBJECTS (BUCKET 'scorm-content')
-- Cấu trúc: scorm-content/<user-id>/<package-id>/...
DROP POLICY IF EXISTS "scorm_content_admin_all" ON storage.objects;
DROP POLICY IF EXISTS "scorm_content_teacher_insert" ON storage.objects;
DROP POLICY IF EXISTS "scorm_content_teacher_delete" ON storage.objects;
DROP POLICY IF EXISTS "scorm_content_select" ON storage.objects;

-- Admin toàn quyền trên storage scorm-content (upload, select, delete mọi package)
CREATE POLICY "scorm_content_admin_all"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'scorm-content'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'scorm-content'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- Teacher chỉ được tải lên assets vào thư mục user-id của mình VÀ phải map tới package row của mình (Ownership Anchor)
CREATE POLICY "scorm_content_teacher_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'scorm-content'
  AND (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND EXISTS (
        SELECT 1 FROM public.scorm_packages sp
        WHERE (
          sp.id::text = (storage.foldername(name))[2]
          OR sp.content_root = (storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]
        )
        AND sp.created_by = auth.uid()
      )
    )
  )
);

-- Teacher xóa assets trong thư mục user-id của mình thuộc package của mình
CREATE POLICY "scorm_content_teacher_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'scorm-content'
  AND (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND (
        EXISTS (
          SELECT 1 FROM public.scorm_packages sp
          WHERE (
            sp.id::text = (storage.foldername(name))[2]
            OR sp.content_root = (storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]
          )
          AND sp.created_by = auth.uid()
        )
        -- Fallback khi dọn dẹp rollback
        OR (storage.foldername(name))[1] = auth.uid()::text
      )
    )
  )
);

-- Quyền đọc file asset SCORM cho authenticated users có quyền bài giảng theo Phase 1
CREATE POLICY "scorm_content_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'scorm-content'
  AND (
    -- Admin
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    -- Chủ sở hữu gói bài giảng (thư mục user-id)
    OR (storage.foldername(name))[1] = auth.uid()::text
    -- Người dùng được quyền xem tài liệu theo Visibility Phase 1 và package đã ready
    OR EXISTS (
      SELECT 1 FROM public.scorm_packages sp
      JOIN public.learning_materials lm ON lm.id = sp.material_id
      WHERE (
        sp.id::text = (storage.foldername(name))[2]
        OR sp.content_root = (storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]
      )
      AND sp.status = 'ready'
      AND (
        lm.created_by = auth.uid()
        OR lm.visibility IN ('school', 'public')
        OR (
          lm.visibility = 'class' AND (
            EXISTS (
              SELECT 1 FROM public.class_members cm
              WHERE cm.class_id = lm.class_id AND cm.student_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.classes c
              WHERE c.id = lm.class_id AND c.teacher_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.learning_material_shares lms
              JOIN public.class_members cm ON cm.class_id = lms.class_id
              WHERE lms.material_id = lm.id AND cm.student_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.learning_material_shares lms
              JOIN public.classes c ON c.id = lms.class_id
              WHERE lms.material_id = lm.id AND c.teacher_id = auth.uid()
            )
          )
        )
      )
    )
  )
);

-- 7. PHÂN QUYỀN TRUY CẬP CHO CÁC ROLE TRÊN DATABASE
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scorm_packages TO authenticated, service_role, postgres;
REVOKE ALL ON public.scorm_packages FROM anon;

COMMIT;
