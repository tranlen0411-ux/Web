-- ============================================================================
-- SQL MIGRATION: KHẮC PHỤC BẢO MẬT GÓC TÀI LIỆU (PRIVATE BUCKET & RLS CHẶT CHẼ)
-- ============================================================================

-- 1. CHUYỂN BUCKET 'learning-materials' SANG PRIVATE (PUBLIC = FALSE)
-- VÀ THIẾT LẬP GIỚI HẠN DUNG LƯỢNG 50MB & MIME TYPES
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'learning-materials',
  'learning-materials',
  false, -- BUCKET PRIVATE BẢO MẬT (KHÔNG CÓ PUBLIC URL)
  52428800, -- Giới hạn 50 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
  ];

-- 2. ĐẢM BẢO CẤU TRÚC BẢNG PUBLIC.LEARNING_MATERIALS
CREATE TABLE IF NOT EXISTS public.learning_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  file_name TEXT,
  file_path TEXT,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'word', 'powerpoint', 'image', 'video', 'link')),
  file_size BIGINT DEFAULT 0,
  external_url TEXT,
  allow_download BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- KÍCH HOẠT ROW LEVEL SECURITY (RLS)
ALTER TABLE public.learning_materials ENABLE ROW LEVEL SECURITY;

-- XÓA POLICY CŨ ĐỂ KHỞI TẠO LẠI CHÍNH XÁC
DROP POLICY IF EXISTS "learning_materials_select_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_insert_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_update_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_delete_policy" ON public.learning_materials;

-- DB POLICY 1: CHỌN / XEM TÀI LIỆU (SELECT)
CREATE POLICY "learning_materials_select_policy"
ON public.learning_materials FOR SELECT
TO authenticated
USING (
  -- Admin được xem tất cả
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  -- Giáo viên được xem tài liệu do mình tạo hoặc thuộc lớp do mình quản lý
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND (
      created_by = auth.uid()
      OR class_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = learning_materials.class_id AND c.teacher_id = auth.uid()
      )
    )
  )
  OR
  -- Học sinh chỉ được xem tài liệu thuộc lớp mình đang học hoặc tài liệu chung
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'student'
    AND (
      class_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.class_members cm
        WHERE cm.class_id = learning_materials.class_id AND cm.student_id = auth.uid()
      )
    )
  )
);

-- DB POLICY 2: THÊM TÀI LIỆU (INSERT)
CREATE POLICY "learning_materials_insert_policy"
ON public.learning_materials FOR INSERT
TO authenticated
WITH CHECK (
  -- Admin được thêm cho mọi lớp
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  -- Giáo viên chỉ được thêm tài liệu do chính mình tạo cho lớp mình phụ trách
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND created_by = auth.uid()
    AND (
      class_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = class_id AND c.teacher_id = auth.uid()
      )
    )
  )
);

-- DB POLICY 3: CẬP NHẬT TÀI LIỆU (UPDATE)
-- Siết chặt: Giáo viên KHÔNG ĐƯỢC đổi created_by và chỉ được gán vào lớp mình phụ trách
CREATE POLICY "learning_materials_update_policy"
ON public.learning_materials FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND created_by = auth.uid()
  )
)
WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND created_by = auth.uid()
    AND (
      class_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = class_id AND c.teacher_id = auth.uid()
      )
    )
  )
);

-- DB POLICY 4: XÓA TÀI LIỆU (DELETE)
CREATE POLICY "learning_materials_delete_policy"
ON public.learning_materials FOR DELETE
TO authenticated
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND created_by = auth.uid()
  )
);

-- 3. THIẾT LẬP STORAGE RLS CHẶT CHẼ THEO CẤU TRÚC THƯ MỤC {created_by}/{filename}
DROP POLICY IF EXISTS "learning_materials_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "learning_materials_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "learning_materials_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "learning_materials_storage_delete" ON storage.objects;

-- STORAGE SELECT: Đọc file nếu người dùng có quyền xem record tài liệu tương ứng
CREATE POLICY "learning_materials_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'learning-materials'
  AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.learning_materials lm
      WHERE lm.file_path = name
    )
  )
);

-- STORAGE INSERT: Giáo viên chỉ upload vào thư mục riêng trùng với auth.uid() của mình
CREATE POLICY "learning_materials_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'learning-materials'
  AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
  )
);

-- STORAGE UPDATE: Giáo viên chỉ cập nhật file trong thư mục của mình
CREATE POLICY "learning_materials_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'learning-materials'
  AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
  )
);

-- STORAGE DELETE: Giáo viên chỉ được xóa file trong thư mục do mình sở hữu
CREATE POLICY "learning_materials_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'learning-materials'
  AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
  )
);
