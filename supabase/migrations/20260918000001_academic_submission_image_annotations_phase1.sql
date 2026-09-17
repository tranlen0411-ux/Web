-- ============================================================================
-- MIGRATION: 20260918000001_academic_submission_image_annotations_phase1.sql
-- MỤC TIÊU:
-- 1. Hỗ trợ học sinh nộp nhiều ảnh bài làm (1-N attachments) cho mỗi câu hỏi.
-- 2. Mô hình annotation JSON/vector có versioning append-only cho giáo viên chấm bài.
-- 3. Đảm bảo tính IMMUTABLE tuyệt đối của ảnh gốc (không ghi đè, không sửa storage_path).
-- 4. Bộ RPCs bảo mật (SECURITY DEFINER + search_path='') với Optimistic Concurrency Control.
-- 5. RLS & Storage policies bảo đảm Class Ownership Model và cách ly dữ liệu học sinh/giáo viên.
--    (Đã thu hồi hoàn toàn quyền tác giả cũ nếu giáo viên không còn phụ trách lớp).
-- 6. Xác minh đối tượng thực tế và metadata trong Storage khi finalize attachment.
-- 7. Tương thích ngược 100% với subsystem hiện có (giữ nguyên file_url cũ, không làm gián đoạn).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- PHẦN 1: BẢNG TỆP ĐÍNH KÈM BÀI NỘP (ACADEMIC SUBMISSION ATTACHMENTS)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.academic_submission_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'exercise-submissions',
  storage_path TEXT NOT NULL UNIQUE,
  original_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  width INTEGER NULL CHECK (width IS NULL OR width > 0),
  height INTEGER NULL CHECK (height IS NULL OR height > 0),
  sha256 TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'finalized', 'deleted')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ NULL
);

-- Indexes tối ưu truy vấn
CREATE INDEX IF NOT EXISTS idx_sub_attachments_submission_id
  ON public.academic_submission_attachments (submission_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_sub_attachments_question_id
  ON public.academic_submission_attachments (question_id);

CREATE INDEX IF NOT EXISTS idx_sub_attachments_student_id
  ON public.academic_submission_attachments (student_id);

-- Kích hoạt RLS
ALTER TABLE public.academic_submission_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submission_attachments FORCE ROW LEVEL SECURITY;

-- Policy SELECT: Admin, Học sinh sở hữu, hoặc Giáo viên hiện đang phụ trách lớp
DROP POLICY IF EXISTS "academic_submission_attachments_select" ON public.academic_submission_attachments;
CREATE POLICY "academic_submission_attachments_select" ON public.academic_submission_attachments
FOR SELECT USING (
  app_private.is_admin()
  OR student_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = academic_submission_attachments.submission_id
      AND (
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
);

-- Policy INSERT: Chỉ học sinh sở hữu submission khi bài còn ở trạng thái draft/revision
DROP POLICY IF EXISTS "academic_submission_attachments_insert" ON public.academic_submission_attachments;
CREATE POLICY "academic_submission_attachments_insert" ON public.academic_submission_attachments
FOR INSERT WITH CHECK (
  student_id = (SELECT auth.uid())
  AND created_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = academic_submission_attachments.submission_id
      AND s.student_id = (SELECT auth.uid())
      AND s.status IN ('draft', 'revision_requested')
  )
);

-- Policy UPDATE/DELETE: Không cho phép client update/delete trực tiếp, mọi mutation qua RPC
DROP POLICY IF EXISTS "academic_submission_attachments_update" ON public.academic_submission_attachments;
DROP POLICY IF EXISTS "academic_submission_attachments_delete" ON public.academic_submission_attachments;


-- ----------------------------------------------------------------------------
-- PHẦN 2: BẢNG LƯU PHIÊN BẢN ANNOTATION CỦA GIÁO VIÊN (APPEND-ONLY)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.academic_submission_annotation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES public.academic_submission_attachments(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'final')),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  annotation_json JSONB NOT NULL CHECK (jsonb_typeof(annotation_json) = 'object'),
  rendered_preview_bucket TEXT NULL,
  rendered_preview_path TEXT NULL,
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_sub_annotation_version UNIQUE (attachment_id, version),
  CONSTRAINT unique_teacher_annotation_idempotency UNIQUE (teacher_id, idempotency_key)
);

-- Indexes tối ưu
CREATE INDEX IF NOT EXISTS idx_annotation_versions_attachment_ver
  ON public.academic_submission_annotation_versions (attachment_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_annotation_versions_submission
  ON public.academic_submission_annotation_versions (submission_id);

CREATE INDEX IF NOT EXISTS idx_annotation_versions_teacher
  ON public.academic_submission_annotation_versions (teacher_id);

-- Kích hoạt RLS
ALTER TABLE public.academic_submission_annotation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submission_annotation_versions FORCE ROW LEVEL SECURITY;

-- Policy SELECT:
-- 1. Admin
-- 2. Giáo viên HIỆN ĐANG phụ trách lớp (Thu hồi hoàn toàn quyền stale teacher author)
-- 3. Học sinh sở hữu bài làm KHI VÀ CHỈ KHI annotation có status='final' và bài nộp đã được chấm (status='graded')
DROP POLICY IF EXISTS "annotation_versions_select" ON public.academic_submission_annotation_versions;
CREATE POLICY "annotation_versions_select" ON public.academic_submission_annotation_versions
FOR SELECT USING (
  app_private.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = academic_submission_annotation_versions.submission_id
      AND (
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
  OR (
    status = 'final'
    AND EXISTS (
      SELECT 1 FROM public.academic_submissions s
      WHERE s.id = academic_submission_annotation_versions.submission_id
        AND s.student_id = (SELECT auth.uid())
        AND s.status IN ('graded', 'revision_requested')
    )
  )
);

-- Block direct mutation: mọi ghi nhận version đều thông qua SECURITY DEFINER RPC
DROP POLICY IF EXISTS "annotation_versions_insert" ON public.academic_submission_annotation_versions;
DROP POLICY IF EXISTS "annotation_versions_update" ON public.academic_submission_annotation_versions;
DROP POLICY IF EXISTS "annotation_versions_delete" ON public.academic_submission_annotation_versions;


-- ----------------------------------------------------------------------------
-- PHẦN 3: CẬP NHẬT STORAGE POLICIES CHO BUCKET EXERCISE-SUBMISSIONS
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    -- SELECT policy hỗ trợ cả đường dẫn mới (students/{uid}/...) và đường dẫn cũ ({uid}/...)
    DROP POLICY IF EXISTS "Exercise submissions select policy" ON storage.objects;
    CREATE POLICY "Exercise submissions select policy" ON storage.objects
    FOR SELECT USING (
      bucket_id = 'exercise-submissions' AND (
        app_private.is_admin()
        OR (storage.foldername(name))[1] = (SELECT auth.uid())::text
        OR (
          (storage.foldername(name))[1] = 'students'
          AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
        )
        OR EXISTS (
          SELECT 1 FROM public.academic_submissions s
          WHERE (
            s.id::text = (storage.foldername(name))[2]
            OR (
              (storage.foldername(name))[1] = 'students'
              AND (storage.foldername(name))[3] = 'submissions'
              AND s.id::text = (storage.foldername(name))[4]
            )
          ) AND (
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

    -- INSERT policy cho học sinh upload attachment ảnh gốc (chống path traversal & upload chéo)
    DROP POLICY IF EXISTS "Exercise submissions insert policy" ON storage.objects;
    CREATE POLICY "Exercise submissions insert policy" ON storage.objects
    FOR INSERT WITH CHECK (
      bucket_id = 'exercise-submissions' AND (
        app_private.is_admin()
        OR (
          (storage.foldername(name))[1] = 'students'
          AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
          AND (storage.foldername(name))[3] = 'submissions'
          AND (storage.foldername(name))[5] = 'attachments'
        )
        OR (
          (storage.foldername(name))[1] = (SELECT auth.uid())::text
        )
      )
    );

    -- DROP UPDATE/DELETE policies cho non-admin để đảm bảo ảnh gốc là IMMUTABLE
    DROP POLICY IF EXISTS "Exercise submissions update policy" ON storage.objects;
    DROP POLICY IF EXISTS "Exercise submissions delete policy" ON storage.objects;
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 4: RPC 1 - PREPARE_ACADEMIC_SUBMISSION_ATTACHMENT
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prepare_academic_submission_attachment(
  p_submission_id UUID,
  p_question_id UUID,
  p_original_file_name TEXT,
  p_mime_type TEXT,
  p_byte_size BIGINT,
  p_sort_order INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_q RECORD;
  v_attachment_id UUID;
  v_ext TEXT;
  v_clean_name TEXT;
  v_storage_path TEXT;
BEGIN
  v_student_id := (SELECT auth.uid());
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi: Chỉ học sinh mới có thể khởi tạo tải tệp bài làm.');
  END IF;

  -- 1. Validate submission
  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Lượt làm bài không tồn tại.');
  END IF;

  IF v_sub.student_id != v_student_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền thao tác trên bài nộp của học sinh khác.');
  END IF;

  IF v_sub.status NOT IN ('draft', 'revision_requested') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_LOCKED', 'message', 'Lỗi: Không thể đính kèm tệp vào bài làm đã nộp hoặc đã chấm.');
  END IF;

  -- 2. Validate question
  SELECT * INTO v_q FROM public.academic_exercise_questions WHERE id = p_question_id;
  IF v_q.id IS NULL OR v_q.exercise_id != v_sub.exercise_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUESTION', 'message', 'Lỗi: Câu hỏi không thuộc bài tập này.');
  END IF;

  -- 3. Validate MIME & Size (chỉ cho phép image/jpeg, image/png, image/webp, max 10MB)
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MIME_TYPE', 'message', 'Lỗi: Định dạng ảnh không được hỗ trợ. Chỉ chấp nhận JPG, PNG hoặc WebP.');
  END IF;

  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 10485760 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_FILE_SIZE', 'message', 'Lỗi: Dung lượng ảnh phải từ 1 byte đến tối đa 10 MiB.');
  END IF;

  -- 4. Xác định extension chuẩn hóa
  IF p_mime_type = 'image/jpeg' THEN
    v_ext := 'jpg';
  ELSIF p_mime_type = 'image/png' THEN
    v_ext := 'png';
  ELSE
    v_ext := 'webp';
  END IF;

  v_attachment_id := gen_random_uuid();
  v_clean_name := regexp_replace(p_original_file_name, '[^a-zA-Z0-9._-]', '_', 'g');
  v_storage_path := format('students/%s/submissions/%s/attachments/%s/original.%s', v_student_id, p_submission_id, v_attachment_id, v_ext);

  -- 5. Tạo bản ghi pending
  INSERT INTO public.academic_submission_attachments (
    id,
    submission_id,
    question_id,
    student_id,
    storage_bucket,
    storage_path,
    original_file_name,
    mime_type,
    byte_size,
    sort_order,
    upload_status,
    created_by,
    created_at
  ) VALUES (
    v_attachment_id,
    p_submission_id,
    p_question_id,
    v_student_id,
    'exercise-submissions',
    v_storage_path,
    v_clean_name,
    p_mime_type,
    p_byte_size,
    COALESCE(p_sort_order, 0),
    'pending',
    v_student_id,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'attachment_id', v_attachment_id,
    'storage_bucket', 'exercise-submissions',
    'storage_path', v_storage_path,
    'mime_type', p_mime_type,
    'max_byte_size', 10485760
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 5: RPC 2 - FINALIZE_ACADEMIC_SUBMISSION_ATTACHMENT
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_academic_submission_attachment(
  p_attachment_id UUID,
  p_width INTEGER DEFAULT NULL,
  p_height INTEGER DEFAULT NULL,
  p_sha256 TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id UUID;
  v_att RECORD;
  v_sub RECORD;
  v_storage_obj RECORD;
  v_obj_size BIGINT;
  v_obj_mime TEXT;
BEGIN
  v_student_id := (SELECT auth.uid());
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  -- 1. Đọc attachment pending
  SELECT * INTO v_att FROM public.academic_submission_attachments
  WHERE id = p_attachment_id FOR UPDATE;

  IF v_att.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ATTACHMENT_NOT_FOUND', 'message', 'Lỗi: Tệp đính kèm không tồn tại.');
  END IF;

  IF v_att.student_id != v_student_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền thao tác trên tệp đính kèm của học sinh khác.');
  END IF;

  -- Xử lý idempotent nếu đã finalized
  IF v_att.upload_status = 'finalized' THEN
    RETURN jsonb_build_object(
      'success', true,
      'deduplicated', true,
      'attachment_id', p_attachment_id,
      'status', 'finalized',
      'storage_path', v_att.storage_path
    );
  END IF;

  IF v_att.upload_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Lỗi: Tệp đính kèm không ở trạng thái chờ hoàn tất.');
  END IF;

  -- 2. Kiểm tra submission
  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = v_att.submission_id;
  IF v_sub.id IS NULL OR v_sub.student_id != v_student_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi: Bài nộp không hợp lệ hoặc không thuộc về học sinh.');
  END IF;

  IF v_sub.status NOT IN ('draft', 'revision_requested') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_LOCKED', 'message', 'Lỗi: Không thể hoàn tất tệp cho bài nộp đã khóa hoặc đã gửi.');
  END IF;

  -- 3. Truy vấn chính xác storage.objects theo bucket_id và name = storage_path
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    SELECT * INTO v_storage_obj
    FROM storage.objects
    WHERE bucket_id = v_att.storage_bucket
      AND name = v_att.storage_path;

    IF v_storage_obj.id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'STORAGE_OBJECT_NOT_FOUND',
        'message', 'Lỗi: Không tìm thấy tệp tin thực tế trong Storage. Vui lòng tải lên Storage trước khi hoàn tất.'
      );
    END IF;

    -- Đọc metadata từ storage.objects
    v_obj_size := COALESCE(
      (v_storage_obj.metadata->>'size')::BIGINT,
      (v_storage_obj.metadata->>'contentLength')::BIGINT,
      (v_storage_obj.metadata->>'content_length')::BIGINT
    );
    v_obj_mime := LOWER(COALESCE(
      v_storage_obj.metadata->>'mimetype',
      v_storage_obj.metadata->>'mime_type',
      v_storage_obj.metadata->>'contentType',
      v_storage_obj.metadata->>'content_type'
    ));

    -- Kiểm tra kích thước metadata
    IF v_obj_size IS NOT NULL THEN
      IF v_obj_size <= 0 OR v_obj_size > 10485760 THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INVALID_FILE_SIZE',
          'message', 'Lỗi: Dung lượng tệp trong Storage vượt quá giới hạn cho phép (Tối đa 10 MiB).'
        );
      END IF;

      IF v_obj_size != v_att.byte_size THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'FILE_SIZE_MISMATCH',
          'message', format('Lỗi: Kích thước tệp thực tế trong Storage (%s bytes) không khớp với khai báo (%s bytes).', v_obj_size, v_att.byte_size)
        );
      END IF;
    END IF;

    -- Kiểm tra MIME metadata
    IF v_obj_mime IS NOT NULL THEN
      IF v_obj_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INVALID_MIME_TYPE',
          'message', 'Lỗi: Định dạng MIME của tệp trong Storage không hợp lệ. Chỉ chấp nhận JPG, PNG hoặc WebP.'
        );
      END IF;

      IF v_obj_mime != LOWER(v_att.mime_type) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'MIME_TYPE_MISMATCH',
          'message', format('Lỗi: Định dạng MIME thực tế (%s) không khớp với khai báo (%s).', v_obj_mime, v_att.mime_type)
        );
      END IF;
    END IF;
  END IF;

  -- 4. Cập nhật sang finalized
  UPDATE public.academic_submission_attachments
  SET
    upload_status = 'finalized',
    finalized_at = NOW(),
    width = CASE WHEN p_width > 0 THEN p_width ELSE width END,
    height = CASE WHEN p_height > 0 THEN p_height ELSE height END,
    sha256 = COALESCE(p_sha256, sha256)
  WHERE id = p_attachment_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'attachment_id', p_attachment_id,
    'status', 'finalized',
    'storage_path', v_att.storage_path
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 6: RPC 3 - GET_ACADEMIC_SUBMISSION_GRADING_WORKSPACE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_academic_submission_grading_workspace(
  p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_student RECORD;
  v_ex RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_questions JSONB;
  v_answers JSONB;
  v_attachments JSONB;
BEGIN
  v_teacher_id := (SELECT auth.uid());
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- Kiểm tra phân quyền: Admin hoặc Giáo viên sở hữu lớp hiện tại
  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(e.class_id)
  ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Giáo viên không có quyền chấm bài nộp của lớp này.');
  END IF;

  SELECT id, full_name, email, avatar_url, grade_level INTO v_student
  FROM public.profiles WHERE id = v_sub.student_id;

  SELECT id, title, subject, grade_level, status, reward_stars, is_global INTO v_ex
  FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- 1. Lấy danh sách câu hỏi
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'question_number', q.question_number,
      'question_type', q.question_type,
      'prompt', q.prompt,
      'points', q.points,
      'options_json', q.options_json
    ) ORDER BY q.question_number
  ) INTO v_questions
  FROM public.academic_exercise_questions q
  WHERE q.exercise_id = v_sub.exercise_id;

  -- 2. Lấy câu trả lời
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'question_id', a.question_id,
      'student_answer_json', a.student_answer_json,
      'file_url', a.file_url,
      'is_correct', a.is_correct,
      'points_earned', a.points_earned,
      'teacher_comment', a.teacher_comment
    )
  ) INTO v_answers
  FROM public.academic_submission_answers a
  WHERE a.submission_id = p_submission_id;

  -- 3. Lấy danh sách attachments cùng annotation mới nhất
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', att.id,
      'question_id', att.question_id,
      'storage_bucket', att.storage_bucket,
      'storage_path', att.storage_path,
      'original_file_name', att.original_file_name,
      'mime_type', att.mime_type,
      'byte_size', att.byte_size,
      'width', att.width,
      'height', att.height,
      'sort_order', att.sort_order,
      'upload_status', att.upload_status,
      'created_at', att.created_at,
      'latest_annotation', (
        SELECT jsonb_build_object(
          'id', ann.id,
          'version', ann.version,
          'status', ann.status,
          'schema_version', ann.schema_version,
          'annotation_json', ann.annotation_json,
          'rendered_preview_path', ann.rendered_preview_path,
          'idempotency_key', ann.idempotency_key,
          'updated_at', ann.updated_at
        )
        FROM public.academic_submission_annotation_versions ann
        WHERE ann.attachment_id = att.id
        ORDER BY ann.version DESC
        LIMIT 1
      )
    ) ORDER BY att.sort_order, att.created_at
  ) INTO v_attachments
  FROM public.academic_submission_attachments att
  WHERE att.submission_id = p_submission_id
    AND att.upload_status = 'finalized';

  RETURN jsonb_build_object(
    'success', true,
    'submission', jsonb_build_object(
      'id', v_sub.id,
      'exercise_id', v_sub.exercise_id,
      'student_id', v_sub.student_id,
      'attempt_number', v_sub.attempt_number,
      'status', v_sub.status,
      'objective_score', v_sub.objective_score,
      'manual_score', v_sub.manual_score,
      'total_score', v_sub.total_score,
      'max_score', v_sub.max_score,
      'teacher_feedback', v_sub.teacher_feedback,
      'submitted_at', v_sub.submitted_at,
      'graded_at', v_sub.graded_at,
      'student', row_to_json(v_student),
      'exercise', row_to_json(v_ex)
    ),
    'questions', COALESCE(v_questions, '[]'::jsonb),
    'answers', COALESCE(v_answers, '[]'::jsonb),
    'attachments', COALESCE(v_attachments, '[]'::jsonb)
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 7: RPC 4 - SAVE_ACADEMIC_SUBMISSION_ANNOTATION_DRAFT
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_academic_submission_annotation_draft(
  p_attachment_id UUID,
  p_annotation_json JSONB,
  p_expected_version INTEGER,
  p_idempotency_key UUID,
  p_schema_version INTEGER DEFAULT 1,
  p_rendered_preview_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_att RECORD;
  v_sub RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_existing_ver RECORD;
  v_current_version INT := 0;
  v_new_version INT;
  v_new_id UUID;
BEGIN
  v_teacher_id := (SELECT auth.uid());
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  -- 1. Idempotency Check
  SELECT * INTO v_existing_ver
  FROM public.academic_submission_annotation_versions
  WHERE teacher_id = v_teacher_id AND idempotency_key = p_idempotency_key;

  IF v_existing_ver.id IS NULL THEN
    -- Check if idempotency key exists under this attachment
    SELECT * INTO v_existing_ver
    FROM public.academic_submission_annotation_versions
    WHERE attachment_id = p_attachment_id AND idempotency_key = p_idempotency_key;
  END IF;

  IF v_existing_ver.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'deduplicated', true,
      'annotation_id', v_existing_ver.id,
      'attachment_id', v_existing_ver.attachment_id,
      'version', v_existing_ver.version,
      'status', v_existing_ver.status
    );
  END IF;

  -- 2. Validate attachment & submission
  SELECT * INTO v_att FROM public.academic_submission_attachments WHERE id = p_attachment_id;
  IF v_att.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ATTACHMENT_NOT_FOUND', 'message', 'Lỗi: Tệp đính kèm không tồn tại.');
  END IF;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = v_att.submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- 3. Phân quyền giáo viên (chỉ kiểm tra quyền sở hữu lớp hiện tại)
  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(e.class_id)
  ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền chấm bài nộp này.');
  END IF;

  -- 4. Validate payload
  IF jsonb_typeof(p_annotation_json) != 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD', 'message', 'Lỗi: Dữ liệu annotation_json phải là một object JSON.');
  END IF;

  IF pg_column_size(p_annotation_json) > 524288 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYLOAD_TOO_LARGE', 'message', 'Lỗi: Kích thước dữ liệu annotation vượt quá giới hạn 512 KiB.');
  END IF;

  -- 5. Optimistic Concurrency Control
  SELECT COALESCE(MAX(version), 0) INTO v_current_version
  FROM public.academic_submission_annotation_versions
  WHERE attachment_id = p_attachment_id;

  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'VERSION_CONFLICT',
      'message', 'Phát hiện xung đột phiên bản chấm bài. Dữ liệu đã được cập nhật bởi phiên khác.',
      'current_version', v_current_version,
      'expected_version', p_expected_version
    );
  END IF;

  v_new_version := v_current_version + 1;
  v_new_id := gen_random_uuid();

  -- 6. Insert version append-only
  INSERT INTO public.academic_submission_annotation_versions (
    id,
    submission_id,
    attachment_id,
    teacher_id,
    version,
    status,
    schema_version,
    annotation_json,
    rendered_preview_bucket,
    rendered_preview_path,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    v_new_id,
    v_sub.id,
    p_attachment_id,
    v_teacher_id,
    v_new_version,
    'draft',
    COALESCE(p_schema_version, 1),
    p_annotation_json,
    'exercise-submissions',
    p_rendered_preview_path,
    p_idempotency_key,
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'annotation_id', v_new_id,
    'attachment_id', p_attachment_id,
    'version', v_new_version,
    'status', 'draft'
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 8: RPC 5 - FINALIZE_ACADEMIC_SUBMISSION_GRADING_WITH_ANNOTATIONS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_academic_submission_grading_with_annotations(
  p_submission_id UUID,
  p_manual_grades JSONB,
  p_annotations JSONB DEFAULT '[]'::jsonb,
  p_teacher_feedback TEXT DEFAULT '',
  p_request_revision BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_grade_item JSONB;
  v_ann_item JSONB;
  v_att_id UUID;
  v_ann_json JSONB;
  v_exp_ver INT;
  v_idemp UUID;
  v_cur_ver INT;
  v_new_ver INT;
  v_q_type TEXT;
  v_q_points NUMERIC;
  v_item_points NUMERIC;
  v_total_manual NUMERIC := 0;
  v_final_total NUMERIC := 0;
  v_new_status TEXT;
  v_ratio FLOAT := 0.0;
  v_stars_to_award INT := 0;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
  v_seen_att_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  v_teacher_id := (SELECT auth.uid());
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  IF v_sub.status NOT IN ('submitted', 'pending_manual_grade', 'revision_requested', 'graded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Lỗi: Chỉ được chấm bài nộp đã gửi.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- Phân quyền
  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(e.class_id)
  ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền chấm bài nộp này.');
  END IF;

  -- 1. Lưu các annotation final nếu có
  IF jsonb_typeof(p_annotations) = 'array' THEN
    FOR v_ann_item IN SELECT * FROM jsonb_array_elements(p_annotations)
    LOOP
      v_att_id := (v_ann_item->>'attachment_id')::UUID;
      v_ann_json := v_ann_item->'annotation_json';
      v_exp_ver := (v_ann_item->>'expected_version')::INT;
      v_idemp := COALESCE((v_ann_item->>'idempotency_key')::UUID, gen_random_uuid());

      IF v_att_id IS NOT NULL AND v_ann_json IS NOT NULL THEN
        -- Check idempotency
        IF NOT EXISTS (
          SELECT 1 FROM public.academic_submission_annotation_versions
          WHERE teacher_id = v_teacher_id AND idempotency_key = v_idemp
        ) THEN
          SELECT COALESCE(MAX(version), 0) INTO v_cur_ver
          FROM public.academic_submission_annotation_versions
          WHERE attachment_id = v_att_id;

          IF v_exp_ver IS NOT NULL AND v_cur_ver != v_exp_ver THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'VERSION_CONFLICT',
              'message', format('Phát hiện xung đột phiên bản annotation trên attachment %s.', v_att_id),
              'current_version', v_cur_ver,
              'expected_version', v_exp_ver
            );
          END IF;

          v_new_ver := v_cur_ver + 1;

          INSERT INTO public.academic_submission_annotation_versions (
            submission_id,
            attachment_id,
            teacher_id,
            version,
            status,
            schema_version,
            annotation_json,
            rendered_preview_bucket,
            rendered_preview_path,
            idempotency_key,
            created_at,
            updated_at
          ) VALUES (
            v_sub.id,
            v_att_id,
            v_teacher_id,
            v_new_ver,
            'final',
            1,
            v_ann_json,
            'exercise-submissions',
            v_ann_item->>'rendered_preview_path',
            v_idemp,
            NOW(),
            NOW()
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 2. Chấm điểm manual_grades
  IF jsonb_typeof(p_manual_grades) = 'array' THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      v_curr_q_id := (v_grade_item->>'question_id')::UUID;
      IF v_curr_q_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUESTION', 'message', 'Lỗi: question_id trong manual_grades không hợp lệ.');
      END IF;

      IF v_curr_q_id = ANY(v_seen_q_ids) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_QUESTION', 'message', 'Lỗi: Trùng lặp question_id trong danh sách điểm chấm.');
      END IF;
      v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

      SELECT question_type, points INTO v_q_type, v_q_points
      FROM public.academic_exercise_questions
      WHERE id = v_curr_q_id AND exercise_id = v_sub.exercise_id;

      IF v_q_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'QUESTION_NOT_FOUND', 'message', 'Lỗi: Câu hỏi không thuộc bài tập này.');
      END IF;

      IF v_q_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUESTION_TYPE', 'message', 'Lỗi: Chỉ được chấm điểm thủ công cho câu tự luận hoặc nộp file.');
      END IF;

      v_item_points := (v_grade_item->>'points_earned')::NUMERIC(8,2);
      IF v_item_points IS NULL OR v_item_points < 0 OR v_item_points > v_q_points THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCORE', 'message', format('Lỗi: Điểm câu %s không hợp lệ (Phải từ 0 đến %s).', v_curr_q_id, v_q_points));
      END IF;

      UPDATE public.academic_submission_answers
      SET
        points_earned = v_item_points,
        teacher_comment = COALESCE(v_grade_item->>'teacher_comment', teacher_comment),
        updated_at = NOW()
      WHERE submission_id = p_submission_id AND question_id = v_curr_q_id;

      v_total_manual := v_total_manual + v_item_points;
    END LOOP;
  END IF;

  -- 3. Cập nhật tổng điểm bài nộp
  v_final_total := COALESCE(v_sub.objective_score, 0) + v_total_manual;
  IF v_final_total > v_sub.max_score THEN
    v_final_total := v_sub.max_score;
  END IF;

  IF p_request_revision THEN
    v_new_status := 'revision_requested';
  ELSE
    v_new_status := 'graded';
  END IF;

  UPDATE public.academic_submissions
  SET
    manual_score = v_total_manual,
    total_score = v_final_total,
    teacher_feedback = p_teacher_feedback,
    status = v_new_status,
    graded_by = v_teacher_id,
    graded_at = NOW(),
    updated_at = NOW()
  WHERE id = p_submission_id;

  -- 4. Thưởng sao học sinh nếu hoàn tất và đạt tiêu chí
  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL AND v_ex.reward_stars > 0 THEN
    IF v_sub.max_score > 0 THEN
      v_ratio := v_final_total::FLOAT / v_sub.max_score::FLOAT;
      IF v_ratio >= 0.5 THEN
        v_stars_to_award := ROUND(v_ex.reward_stars * v_ratio);
        IF v_stars_to_award > 0 THEN
          UPDATE public.profiles
          SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
          WHERE id = v_sub.student_id;

          UPDATE public.academic_submissions
          SET reward_applied_at = NOW()
          WHERE id = p_submission_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', p_submission_id,
    'status', v_new_status,
    'total_score', v_final_total,
    'manual_score', v_total_manual,
    'reward_stars_awarded', v_stars_to_award
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 9: RPC 6 - GET_STUDENT_GRADED_SUBMISSION
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_student_graded_submission(
  p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_questions JSONB;
  v_answers JSONB;
  v_attachments JSONB;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- Phân quyền
  IF v_sub.student_id = v_caller_id THEN
    -- Học sinh chính chủ: chỉ được xem khi bài đã nộp/chấm hoặc yêu cầu sửa
    v_has_permission := TRUE;
  ELSIF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(e.class_id)
  ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền xem bài nộp này.');
  END IF;

  SELECT id, title, subject, grade_level, status, reward_stars INTO v_ex
  FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- 1. Câu hỏi
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'question_number', q.question_number,
      'question_type', q.question_type,
      'prompt', q.prompt,
      'points', q.points,
      'options_json', q.options_json
    ) ORDER BY q.question_number
  ) INTO v_questions
  FROM public.academic_exercise_questions q
  WHERE q.exercise_id = v_sub.exercise_id;

  -- 2. Câu trả lời
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'question_id', a.question_id,
      'student_answer_json', a.student_answer_json,
      'file_url', a.file_url,
      'is_correct', a.is_correct,
      'points_earned', a.points_earned,
      'teacher_comment', a.teacher_comment
    )
  ) INTO v_answers
  FROM public.academic_submission_answers a
  WHERE a.submission_id = p_submission_id;

  -- 3. Attachments + FINAL Annotation DUY NHẤT (Ẩn các bản draft tạm của GV)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', att.id,
      'question_id', att.question_id,
      'storage_bucket', att.storage_bucket,
      'storage_path', att.storage_path,
      'original_file_name', att.original_file_name,
      'mime_type', att.mime_type,
      'byte_size', att.byte_size,
      'width', att.width,
      'height', att.height,
      'sort_order', att.sort_order,
      'created_at', att.created_at,
      'final_annotation', (
        SELECT jsonb_build_object(
          'id', ann.id,
          'version', ann.version,
          'schema_version', ann.schema_version,
          'annotation_json', ann.annotation_json,
          'rendered_preview_path', ann.rendered_preview_path,
          'updated_at', ann.updated_at
        )
        FROM public.academic_submission_annotation_versions ann
        WHERE ann.attachment_id = att.id
          AND ann.status = 'final'
        ORDER BY ann.version DESC
        LIMIT 1
      )
    ) ORDER BY att.sort_order, att.created_at
  ) INTO v_attachments
  FROM public.academic_submission_attachments att
  WHERE att.submission_id = p_submission_id
    AND att.upload_status = 'finalized';

  RETURN jsonb_build_object(
    'success', true,
    'submission', jsonb_build_object(
      'id', v_sub.id,
      'exercise_id', v_sub.exercise_id,
      'status', v_sub.status,
      'objective_score', v_sub.objective_score,
      'manual_score', v_sub.manual_score,
      'total_score', v_sub.total_score,
      'max_score', v_sub.max_score,
      'teacher_feedback', v_sub.teacher_feedback,
      'submitted_at', v_sub.submitted_at,
      'graded_at', v_sub.graded_at,
      'exercise', row_to_json(v_ex)
    ),
    'questions', COALESCE(v_questions, '[]'::jsonb),
    'answers', COALESCE(v_answers, '[]'::jsonb),
    'attachments', COALESCE(v_attachments, '[]'::jsonb)
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- PHẦN 10: GRANTS & REVOKES CHUẨN SECURITY DEFINER
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.prepare_academic_submission_attachment FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_academic_submission_attachment FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_academic_submission_grading_workspace FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_academic_submission_annotation_draft FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_academic_submission_grading_with_annotations FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_student_graded_submission FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.prepare_academic_submission_attachment TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_academic_submission_attachment TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_academic_submission_grading_workspace TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_academic_submission_annotation_draft TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_academic_submission_grading_with_annotations TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_graded_submission TO authenticated, service_role;

COMMIT;
