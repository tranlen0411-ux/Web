-- ============================================================================
-- SCRIPT MIGRATION TẠO BẢNG PUBLIC.ACADEMIC_EXERCISE_ASSIGNMENTS VÀ RPC BẢO MẬT
-- CHỈ CHO PHÉP GIAO BÀI QUA RPC SECURITY DEFINER (KHÓA INSERT/UPDATE DIRECT)
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. TẠO BẢNG PUBLIC.ACADEMIC_EXERCISE_ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_exercise_class UNIQUE (exercise_id, class_id)
);

-- 2. TẠO INDEX TỐI ƯU HIỆU NĂNG TRUY VẤN
CREATE INDEX IF NOT EXISTS idx_academic_assignments_exercise ON public.academic_exercise_assignments(exercise_id);
CREATE INDEX IF NOT EXISTS idx_academic_assignments_class ON public.academic_exercise_assignments(class_id);

-- 3. CẤP QUYỀN TRUY CẬP AN TOÀN - REVOKE DANGEROUS WRITE PERMISSIONS FROM ANON/AUTHENTICATED
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
REVOKE ALL ON public.academic_exercise_assignments FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.academic_exercise_assignments FROM authenticated;
GRANT SELECT ON public.academic_exercise_assignments TO anon, authenticated;
GRANT ALL ON public.academic_exercise_assignments TO service_role, postgres;

-- 4. CHUYỂN DỮ LIỆU CÁC BÀI ĐÃ XUẤT BẢN HIỆN CÓ SANG BẢNG GIAO BÀI (KHÔNG MẤT DỮ LIỆU CỦ)
INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at, due_date)
SELECT 
  e.id AS exercise_id,
  e.class_id AS class_id,
  e.teacher_id AS assigned_by,
  COALESCE(e.updated_at, e.created_at, NOW()) AS assigned_at,
  e.due_date AS due_date
FROM public.academic_exercises e
WHERE e.class_id IS NOT NULL 
  AND e.is_global IS NOT TRUE
  AND e.status = 'published'
ON CONFLICT (exercise_id, class_id) DO NOTHING;

-- 5. BẬT RLS VÀ CÀI ĐẶT POLICY AN TOÀN KHÔNG ĐỆ QUY VÒNG (NO RECURSIVE LOOP)
ALTER TABLE public.academic_exercise_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Academic assignments select policy" ON public.academic_exercise_assignments;
DROP POLICY IF EXISTS "Academic assignments insert policy" ON public.academic_exercise_assignments;
DROP POLICY IF EXISTS "Academic assignments delete policy" ON public.academic_exercise_assignments;

-- SELECT POLICY:
-- Admin: xem tất cả.
-- Teacher: xem các bài do mình trực tiếp giao (assigned_by) hoặc giao cho lớp do mình phụ trách (classes.teacher_id).
-- Student: xem bài giao cho các lớp mình gia nhập trong class_members.
CREATE POLICY "Academic assignments select policy" ON public.academic_exercise_assignments
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR assigned_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.class_members cm 
    WHERE cm.class_id = academic_exercise_assignments.class_id AND cm.student_id = auth.uid()
  )
);

-- 6. CẬP NHẬT RLS POLICY TRÊN BẢNG PUBLIC.ACADEMIC_EXERCISES (LOẠI BỎ ĐƯỜNG ĐỌC CŨ TỪ CLASS_ID TRỰC TIẾP)
DROP POLICY IF EXISTS "Academic exercises select policy" ON public.academic_exercises;

CREATE POLICY "Academic exercises select policy" ON public.academic_exercises
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR teacher_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  OR (
    status = 'published' AND (
      is_global = true
      OR EXISTS (
        SELECT 1 FROM public.academic_exercise_assignments a
        JOIN public.class_members cm ON cm.class_id = a.class_id
        WHERE a.exercise_id = public.academic_exercises.id AND cm.student_id = auth.uid()
      )
    )
  )
);

-- 7. CẬP NHẬT RLS POLICY TRÊN BẢNG PUBLIC.ACADEMIC_EXERCISE_QUESTIONS (LOẠI BỎ ĐƯỜNG ĐỌC CŨ TỪ CLASS_ID TRỰC TIẾP)
DROP POLICY IF EXISTS "Academic questions select policy" ON public.academic_exercise_questions;

CREATE POLICY "Academic questions select policy" ON public.academic_exercise_questions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR e.teacher_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = e.class_id AND c.teacher_id = auth.uid())
      OR (
        e.status = 'published' AND (
          e.is_global = true 
          OR EXISTS (
            SELECT 1 FROM public.academic_exercise_assignments a
            JOIN public.class_members cm ON cm.class_id = a.class_id
            WHERE a.exercise_id = e.id AND cm.student_id = auth.uid()
          )
        )
      )
    )
  )
);

-- 8. RPC DEFINITION: GIAO BÀI TẬP CHO NHIỀU LỚP ATOMIC CHUẨN BẢO MẬT CHỐNG LỖI NULL VÀ LỚP SAI
CREATE OR REPLACE FUNCTION public.assign_exercise_to_classes(
  p_exercise_id UUID,
  p_class_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_ex RECORD;
  v_class_id UUID;
  v_class_record RECORD;
  v_first_assigned_class_id UUID := NULL;
  v_assigned_names TEXT[] := ARRAY[]::TEXT[];
  v_failed_names TEXT[] := ARRAY[]::TEXT[];
  v_unique_class_ids UUID[];
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền giao bài tập.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại.');
  END IF;

  IF v_caller_role <> 'admin' AND v_ex.teacher_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền quản lý bài tập này.');
  END IF;

  IF p_class_ids IS NULL OR array_length(p_class_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vui lòng chọn ít nhất 1 Lớp học để giao bài.');
  END IF;

  -- Lọc danh sách lớp học duy nhất (loại bỏ ID trùng lặp)
  SELECT ARRAY(SELECT DISTINCT unnest(p_class_ids)) INTO v_unique_class_ids;

  FOREACH v_class_id IN ARRAY v_unique_class_ids
  LOOP
    SELECT * INTO v_class_record FROM public.classes WHERE id = v_class_id;
    IF v_class_record.id IS NULL THEN
      v_failed_names := array_append(v_failed_names, 'ID: ' || v_class_id::text || ' (Không tồn tại)');
      CONTINUE;
    END IF;

    IF v_caller_role <> 'admin' AND v_class_record.teacher_id IS DISTINCT FROM v_caller_id THEN
      v_failed_names := array_append(v_failed_names, v_class_record.name);
      CONTINUE;
    END IF;

    INSERT INTO public.academic_exercise_assignments (
      exercise_id, class_id, assigned_by, assigned_at, due_date
    ) VALUES (
      p_exercise_id, v_class_id, v_caller_id, NOW(), v_ex.due_date
    )
    ON CONFLICT (exercise_id, class_id) DO UPDATE SET
      assigned_by = EXCLUDED.assigned_by,
      assigned_at = NOW(),
      due_date = EXCLUDED.due_date;

    IF v_first_assigned_class_id IS NULL THEN
      v_first_assigned_class_id := v_class_id;
    END IF;

    v_assigned_names := array_append(v_assigned_names, v_class_record.name);
  END LOOP;

  IF array_length(v_assigned_names, 1) > 0 THEN
    UPDATE public.academic_exercises
    SET status = 'published',
        class_id = COALESCE(class_id, v_first_assigned_class_id),
        updated_at = NOW()
    WHERE id = p_exercise_id;

    RETURN jsonb_build_object(
      'success', true,
      'assigned_classes', to_jsonb(v_assigned_names),
      'failed_classes', to_jsonb(v_failed_names),
      'message', 'Đã xuất bản và giao bài tập thành công.'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'failed_classes', to_jsonb(v_failed_names),
      'message', 'Không thể giao bài tập. Bạn không có quyền giao bài hoặc các lớp chọn không hợp lệ.'
    );
  END IF;
END;
$$;

-- SIẾT BẢO MẬT RPC - CHỈ CHO PHÉP TÀI KHOẢN ĐÃ XÁC THỰC (AUTHENTICATED) GỌI HÀM
REVOKE ALL ON FUNCTION public.assign_exercise_to_classes(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_exercise_to_classes(UUID, UUID[]) TO authenticated;

COMMIT;

-- 9. NẠP LẠI SCHEMA CACHE TRÊN SUPABASE POSTGREST ĐỂ CẬP NHẬT NGAY LẬP TỨC
NOTIFY pgrst, 'reload schema';
