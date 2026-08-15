-- ============================================================================
-- SQL MIGRATION: GÓC TÀI LIỆU HỌC TẬP (LEARNING MATERIALS & STORAGE)
-- ============================================================================

-- 1. BẢNG LEARNING_MATERIALS (Kho bài giảng & tài liệu học tập)
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

-- 2. KÍCH HOẠT ROW LEVEL SECURITY (RLS)
ALTER TABLE public.learning_materials ENABLE ROW LEVEL SECURITY;

-- Xóa các policy cũ nếu đã tồn tại để tránh xung đột
DROP POLICY IF EXISTS "learning_materials_select_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_insert_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_update_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_delete_policy" ON public.learning_materials;

-- POLICY 1: CHỌN / XEM TÀI LIỆU (SELECT)
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
  -- Học sinh chỉ được xem tài liệu của lớp mình đang học hoặc tài liệu chung
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

-- POLICY 2: THÊM TÀI LIỆU (INSERT)
CREATE POLICY "learning_materials_insert_policy"
ON public.learning_materials FOR INSERT
TO authenticated
WITH CHECK (
  -- Admin được thêm tài liệu cho mọi lớp
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  -- Giáo viên chỉ thêm cho các lớp mình phụ trách
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

-- POLICY 3: CẬP NHẬT TÀI LIỆU (UPDATE)
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
  )
);

-- POLICY 4: XÓA TÀI LIỆU (DELETE)
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

-- 3. TẠO BUCKET STORAGE 'learning-materials'
INSERT INTO storage.buckets (id, name, public)
VALUES ('learning-materials', 'learning-materials', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies cho 'learning-materials'
DROP POLICY IF EXISTS "learning_materials_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "learning_materials_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "learning_materials_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "learning_materials_storage_delete" ON storage.objects;

CREATE POLICY "learning_materials_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'learning-materials');

CREATE POLICY "learning_materials_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'learning-materials'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  )
);

CREATE POLICY "learning_materials_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'learning-materials'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  )
);

CREATE POLICY "learning_materials_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'learning-materials'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  )
);
