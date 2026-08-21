-- ============================================================================
-- SCRIPT BỔ TRỢ: CẬP NHẬT STORAGE SELECT POLICY CHO BUCKET EXERCISE-SUBMISSIONS
-- PHÂN QUYỀN TRUY CẬP FILE ĐÍNH KÈM BÀI NỘP THEO CLASS OWNERSHIP MODEL
-- AN TOÀN TUYỆT ĐỐI: KHÔNG DÙNG LỆNH ALTER TABLE / OWNER TRÊN SCHEMA STORAGE
-- ============================================================================

DROP POLICY IF EXISTS "Exercise submissions select policy" ON storage.objects;

CREATE POLICY "Exercise submissions select policy" ON storage.objects
FOR SELECT USING (
  bucket_id = 'exercise-submissions' AND (
    app_private.is_admin()
    OR (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.academic_submissions s
      WHERE s.id::text = (storage.foldername(name))[2] AND (
        EXISTS (
          SELECT 1 FROM public.academic_exercise_assignments a
          JOIN public.class_members cm ON cm.class_id = a.class_id
          WHERE a.exercise_id = s.exercise_id
            AND cm.student_id = s.student_id
            AND app_private.teacher_owns_class(a.class_id)
        )
        OR EXISTS (
          SELECT 1 FROM public.academic_exercises e
          JOIN public.class_members cm ON cm.class_id = e.class_id
          WHERE e.id = s.exercise_id
            AND cm.student_id = s.student_id
            AND app_private.teacher_owns_class(e.class_id)
        )
      )
    )
  )
);
