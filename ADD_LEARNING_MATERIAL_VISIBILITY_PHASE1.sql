-- ============================================================================
-- SQL MIGRATION: GÓC TÀI LIỆU - PHÂN QUYỀN CHIA SẺ THEO PHẠM VI (PHASE 1 - HOTFIX)
-- Visibility: 'class' | 'school' | 'public'
-- Hỗ trợ chia sẻ một tài liệu tới nhiều lớp (Cross-Class Sharing)
-- Bảo mật Token-Only & Server-Side Storage Delivery
-- ============================================================================

-- 1. BỔ SUNG CỘT VISIBILITY (TẠM THỜI NULLABLE ĐỂ BACKFILL) VÀ SHARE_TOKEN
ALTER TABLE public.learning_materials
  ADD COLUMN IF NOT EXISTS visibility TEXT;

ALTER TABLE public.learning_materials
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

-- 2. BACKFILL DỮ LIỆU CŨ AN TOÀN (TUYỆT ĐỐI KHÔNG TỰ ĐỘNG GÁN PUBLIC)
-- Tài liệu đã gắn với lớp cụ thể -> visibility = 'class', share_token = NULL
UPDATE public.learning_materials
SET visibility = 'class', share_token = NULL
WHERE class_id IS NOT NULL AND visibility IS NULL;

-- Tài liệu trước đây có class_id là NULL (chung toàn trường) -> visibility = 'school', share_token = NULL
UPDATE public.learning_materials
SET visibility = 'school', share_token = NULL
WHERE class_id IS NULL AND visibility IS NULL;

-- Gán mặc định nếu có bản ghi nào còn sót lại
UPDATE public.learning_materials
SET visibility = 'class', share_token = NULL
WHERE visibility IS NULL;

-- 3. ÁP DỤNG RÀNG BUỘC NOT NULL, DEFAULT VÀ CHECK CONSTRAINTS SAU KHI BACKFILL
ALTER TABLE public.learning_materials
  ALTER COLUMN visibility SET DEFAULT 'class';

ALTER TABLE public.learning_materials
  ALTER COLUMN visibility SET NOT NULL;

-- Constraint 1: Visibility chỉ nhận 'class', 'school', 'public'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learning_materials_visibility_check'
  ) THEN
    ALTER TABLE public.learning_materials
      ADD CONSTRAINT learning_materials_visibility_check
      CHECK (visibility IN ('class', 'school', 'public'));
  END IF;
END $$;

-- Constraint 2: Ràng buộc Server-side Token Consistency: Chỉ 'public' mới có share_token, 'class'/'school' bắt buộc NULL
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_share_token_consistency'
  ) THEN
    ALTER TABLE public.learning_materials
      ADD CONSTRAINT check_share_token_consistency
      CHECK (
        (visibility = 'public' AND share_token IS NOT NULL)
        OR
        (visibility IN ('class', 'school') AND share_token IS NULL)
      );
  END IF;
END $$;

-- Tạo index tăng tốc truy vấn
CREATE INDEX IF NOT EXISTS idx_learning_materials_visibility ON public.learning_materials(visibility);
CREATE INDEX IF NOT EXISTS idx_learning_materials_share_token ON public.learning_materials(share_token);

-- 4. TẠO BẢNG JUNCTION CHIA SẺ LIÊN LỚP (PUBLIC.LEARNING_MATERIAL_SHARES)
CREATE TABLE IF NOT EXISTS public.learning_material_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_material_class_share UNIQUE (material_id, class_id)
);

-- Index tăng tốc truy vấn RLS cho bảng chia sẻ liên lớp
CREATE INDEX IF NOT EXISTS idx_learning_material_shares_mat_class ON public.learning_material_shares(material_id, class_id);
CREATE INDEX IF NOT EXISTS idx_learning_material_shares_class ON public.learning_material_shares(class_id);

-- BẬT ROW LEVEL SECURITY (RLS) CHO BẢNG SHARES
ALTER TABLE public.learning_material_shares ENABLE ROW LEVEL SECURITY;

-- CẤP QUYỀN TRUY CẬP
GRANT ALL ON TABLE public.learning_material_shares TO authenticated, service_role, postgres;
GRANT SELECT ON TABLE public.learning_material_shares TO anon;

-- 5. DATABASE TRIGGER: SERVER-SIDE TOKEN REVOCATION & SHARE ROW CLEANUP
CREATE OR REPLACE FUNCTION public.handle_learning_material_visibility_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Khi chuyển từ 'class' sang 'school' hoặc 'public' -> Tự động xóa sạch các dòng share liên lớp
  IF OLD.visibility = 'class' AND NEW.visibility <> 'class' THEN
    DELETE FROM public.learning_material_shares WHERE material_id = NEW.id;
  END IF;

  -- Khi chuyển từ 'public' sang 'class' hoặc 'school' -> Tự động reset share_token = NULL nếu chưa đặt
  IF OLD.visibility = 'public' AND NEW.visibility <> 'public' THEN
    NEW.share_token := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_learning_material_visibility_change ON public.learning_materials;

CREATE TRIGGER trg_learning_material_visibility_change
  BEFORE UPDATE OF visibility ON public.learning_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_learning_material_visibility_change();

-- 6. BỘ POLICY RLS CHO BẢNG PUBLIC.LEARNING_MATERIAL_SHARES
DROP POLICY IF EXISTS "shares_select_policy" ON public.learning_material_shares;
DROP POLICY IF EXISTS "shares_insert_policy" ON public.learning_material_shares;
DROP POLICY IF EXISTS "shares_delete_policy" ON public.learning_material_shares;

-- READ: Người dùng đã đăng nhập có thể đọc danh sách chia sẻ
CREATE POLICY "shares_select_policy"
ON public.learning_material_shares FOR SELECT
TO authenticated
USING (true);

-- INSERT: Admin toàn quyền; Giáo viên chỉ được share tài liệu do mình tạo VÀ lớp đích do mình phụ trách
CREATE POLICY "shares_insert_policy"
ON public.learning_material_shares FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.learning_materials lm 
      WHERE lm.id = material_id AND lm.created_by = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.classes c 
      WHERE c.id = class_id AND c.teacher_id = auth.uid()
    )
  )
);

-- DELETE: Admin toàn quyền; Giáo viên là chủ tài liệu có thể thu hồi share
CREATE POLICY "shares_delete_policy"
ON public.learning_material_shares FOR DELETE
TO authenticated
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.learning_materials lm 
      WHERE lm.id = material_id AND lm.created_by = auth.uid()
    )
  )
);

-- 7. BỘ POLICY RLS CHO BẢNG PUBLIC.LEARNING_MATERIALS (BẢO MẬT 5 TẦNG)
DROP POLICY IF EXISTS "learning_materials_select_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_insert_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_update_policy" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_delete_policy" ON public.learning_materials;

-- SELECT POLICY: BẢO VỆ CHẶT CHẼ, KHÔNG CHO ANON QUERY DIRECT TABLE
CREATE POLICY "learning_materials_select_policy"
ON public.learning_materials FOR SELECT
TO authenticated
USING (
  -- 1. Admin toàn quyền xem mọi tài liệu
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  -- 2. Giáo viên là tác giả tạo tài liệu
  created_by = auth.uid()
  OR
  -- 3. Tài liệu chia sẻ toàn trường
  visibility = 'school'
  OR
  -- 4. Tài liệu công khai (khi đã đăng nhập vẫn thấy bình thường)
  visibility = 'public'
  OR
  -- 5. Tài liệu theo lớp (Học sinh/Giáo viên thuộc lớp chính hoặc lớp được share)
  (
    visibility = 'class' AND (
      -- Học sinh thuộc lớp chính
      EXISTS (
        SELECT 1 FROM public.class_members cm 
        WHERE cm.class_id = learning_materials.class_id AND cm.student_id = auth.uid()
      )
      OR
      -- Giáo viên phụ trách lớp chính
      EXISTS (
        SELECT 1 FROM public.classes c 
        WHERE c.id = learning_materials.class_id AND c.teacher_id = auth.uid()
      )
      OR
      -- Học sinh thuộc lớp được chia sẻ liên lớp
      EXISTS (
        SELECT 1 FROM public.learning_material_shares lms
        JOIN public.class_members cm ON cm.class_id = lms.class_id
        WHERE lms.material_id = learning_materials.id AND cm.student_id = auth.uid()
      )
      OR
      -- Giáo viên phụ trách lớp được chia sẻ liên lớp
      EXISTS (
        SELECT 1 FROM public.learning_material_shares lms
        JOIN public.classes c ON c.id = lms.class_id
        WHERE lms.material_id = learning_materials.id AND c.teacher_id = auth.uid()
      )
    )
  )
);

-- INSERT POLICY: Giáo viên chỉ được tạo tài liệu cho lớp mình quản lý
CREATE POLICY "learning_materials_insert_policy"
ON public.learning_materials FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR
  (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'teacher'
    AND created_by = auth.uid()
    AND (
      (visibility = 'class' AND class_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid()
      ))
      OR
      (visibility IN ('school', 'public') AND (
        class_id IS NULL OR EXISTS (
          SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid()
        )
      ))
    )
  )
);

-- UPDATE POLICY: Chỉ Owner và Admin được sửa; Giáo viên không được gán lớp ngoài quyền
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
      (visibility = 'class' AND class_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid()
      ))
      OR
      (visibility IN ('school', 'public') AND (
        class_id IS NULL OR EXISTS (
          SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid()
        )
      ))
    )
  )
);

-- DELETE POLICY: Chỉ Owner và Admin được xóa
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

-- 8. RPC: GET PUBLIC LEARNING MATERIAL (CHỈ DÙNG CHO NỘI BỘ BACKEND/EDGE FUNCTION)
CREATE OR REPLACE FUNCTION public.get_public_learning_material(p_share_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_material RECORD;
BEGIN
  -- Validate token
  IF p_share_token IS NULL OR trim(p_share_token) = '' THEN
    RAISE EXCEPTION 'Token chia sẻ không hợp lệ.';
  END IF;

  -- Tìm chính xác 1 tài liệu public có token khớp
  SELECT 
    lm.id,
    lm.title,
    lm.description,
    lm.subject,
    lm.file_name,
    lm.file_path,
    lm.file_type,
    lm.file_size,
    lm.external_url,
    lm.allow_download,
    lm.visibility,
    lm.created_at,
    p.full_name AS author_name,
    c.name AS class_name
  INTO v_material
  FROM public.learning_materials lm
  LEFT JOIN public.profiles p ON p.id = lm.created_by
  LEFT JOIN public.classes c ON c.id = lm.class_id
  WHERE lm.share_token = p_share_token AND lm.visibility = 'public';

  IF v_material.id IS NULL THEN
    RAISE EXCEPTION 'Tài liệu không tồn tại hoặc đã ngừng chia sẻ công khai.';
  END IF;

  RETURN jsonb_build_object(
    'id', v_material.id,
    'title', v_material.title,
    'description', v_material.description,
    'subject', v_material.subject,
    'file_name', v_material.file_name,
    'file_path', v_material.file_path,
    'file_type', v_material.file_type,
    'file_size', v_material.file_size,
    'external_url', v_material.external_url,
    'allow_download', v_material.allow_download,
    'visibility', v_material.visibility,
    'author_name', COALESCE(v_material.author_name, 'Thầy/Cô Giáo'),
    'class_name', v_material.class_name,
    'created_at', v_material.created_at
  );
END;
$$;

-- CHUẨN HÓA QUYỀN RPC: THU HỒI TỪ PUBLIC, CHỈ CẤP CHO AUTHENTICATED & SERVICE ROLE
REVOKE EXECUTE ON FUNCTION public.get_public_learning_material(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_learning_material(TEXT) TO authenticated, service_role, postgres;

-- 9. CẬP NHẬT STORAGE SELECT POLICY: CHỈ CHO PHÉP AUTHENTICATED THEO QUYỀN
-- TUYỆT ĐỐI KHÔNG CẤP QUYỀN SELECT CHO ANON TRÊN STORAGE OBJECTS (BUCKET 100% PRIVATE)
DROP POLICY IF EXISTS "learning_materials_storage_select" ON storage.objects;

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
