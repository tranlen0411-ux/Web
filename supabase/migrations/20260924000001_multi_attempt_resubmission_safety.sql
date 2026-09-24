-- ============================================================================
-- MIGRATION: MULTI-ATTEMPT RESUBMISSION DATA SAFETY & ISOLATION
-- Version: 20260924000001
-- Mục tiêu: 
-- 1. Sửa blocker REVISION_OVERWRITE_RISK: Tách biệt hoàn toàn các lượt nộp bài (attempts).
-- 2. Khi giáo viên yêu cầu làm lại (status = 'revision_requested'), lần làm lại của học sinh
--    sẽ tạo một bản ghi academic_submissions mới (attempt_number = MAX + 1), không ghi đè Attempt cũ.
-- 3. Bảo toàn 100% dữ liệu lịch sử (answers, attachments, annotations, points, feedback) của các attempt trước.
-- 4. Đảm bảo Transaction-safe, chống Parallel Resubmit, Double-click Duplicate Attempt.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RPC: create_or_get_submission_draft
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_or_get_submission_draft(p_exercise_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_student_id UUID;
  v_role TEXT;
  v_ex RECORD;
  v_is_member BOOLEAN := FALSE;
  v_sub_id UUID;
  v_existing_attempts INT := 0;
  v_latest_status TEXT;
  v_attempt_num INT := 1;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chỉ học sinh mới có thể tạo bản nháp bài làm.');
  END IF;

  -- 1.1 Khóa advisory transaction chống song song / tranh chấp tạo attempt
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || p_exercise_id::text || '_' || v_student_id::text));

  -- 1.2 Đọc bài tập và xác minh trạng thái
  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL OR v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại hoặc chưa xuất bản.');
  END IF;

  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Đã quá hạn làm bài tập này.');
  END IF;

  IF v_ex.is_global IS NOT TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.class_members WHERE class_id = v_ex.class_id AND student_id = v_student_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bé không thuộc lớp học được giao bài tập này.');
    END IF;
  END IF;

  -- 1.3 CHỈ TÌM BẢN NHÁP DRAFT ĐANG DANG DỞ (TUYỆT ĐỐI KHÔNG TÁI SỬ DỤNG REVISION_REQUESTED HAY ATTEMPT ĐÃ CHẤM)
  SELECT id, attempt_number INTO v_sub_id, v_attempt_num
  FROM public.academic_submissions 
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status = 'draft'
  ORDER BY attempt_number DESC LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'submission_id', v_sub_id, 'attempt_number', v_attempt_num);
  END IF;

  -- 1.4 Kiểm tra trạng thái bài làm gần nhất và giới hạn số lần làm bài
  SELECT status INTO v_latest_status
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id
  ORDER BY attempt_number DESC LIMIT 1;

  SELECT COUNT(*) INTO v_existing_attempts 
  FROM public.academic_submissions 
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft';

  -- Nếu không phải GV yêu cầu làm lại (revision_requested) thì kiểm tra max_attempts
  IF v_existing_attempts >= COALESCE(v_ex.max_attempts, 1) AND v_latest_status != 'revision_requested' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bé đã hết số lượt nộp bài cho phép.');
  END IF;

  -- 1.5 Tăng attempt_number tuần tự chính xác = MAX(attempt_number) + 1
  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_attempt_num
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id;

  INSERT INTO public.academic_submissions (
    exercise_id, student_id, attempt_number, status, max_score
  ) VALUES (
    p_exercise_id, v_student_id, v_attempt_num, 'draft', 100
  ) RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object('success', true, 'submission_id', v_sub_id, 'attempt_number', v_attempt_num);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_or_get_submission_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_get_submission_draft(UUID) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. RPC: submit_academic_exercise
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_academic_exercise(p_exercise_id uuid, p_answers jsonb, p_is_draft boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_student_id UUID;
  v_role TEXT;
  v_ex RECORD;
  v_is_member BOOLEAN := FALSE;
  v_existing_attempts INT := 0;
  v_latest_status TEXT;
  v_attempt_num INT := 1;
  v_submission_id UUID;
  v_q RECORD;
  v_key RECORD;
  v_ans_item JSONB;
  v_student_ans JSONB;
  v_file_url TEXT;
  v_is_correct BOOLEAN;
  v_points_earned INT;
  v_obj_score INT := 0;
  v_max_score INT := 0;
  v_has_subjective BOOLEAN := FALSE;
  v_status TEXT;
  v_ratio FLOAT := 0.0;
  v_reward_stars INT := 0;
  v_already_applied TIMESTAMPTZ;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
  v_file_exists BOOLEAN := FALSE;
  v_total_questions_count INT := 0;
  v_has_any_file BOOLEAN := FALSE;
  v_opt_match BOOLEAN := FALSE;
  v_distinct_count INT := 0;
BEGIN
  -- =========================================================================
  -- PHASE 1: ZERO-DML VALIDATION PHASE (KHÔNG CHẠY LỆNH INSERT/UPDATE/DELETE NÀO)
  -- =========================================================================
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ tài khoản Học sinh mới được phép nộp bài tập tích sao.');
  END IF;

  IF jsonb_typeof(p_answers) != 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc câu trả lời p_answers phải là một mảng JSON.');
  END IF;

  -- 1.1 Khóa advisory transaction chống race condition
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || p_exercise_id::text || '_' || v_student_id::text));

  -- 1.2 Đọc bài tập và xác minh trạng thái
  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL OR v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập không tồn tại hoặc chưa xuất bản.');
  END IF;

  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đã quá hạn nộp bài tập này.');
  END IF;

  IF v_ex.is_global IS NOT TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.class_members WHERE class_id = v_ex.class_id AND student_id = v_student_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bé không thuộc lớp học được giao bài tập này.');
    END IF;
  END IF;

  -- 1.3 Xác định submission_id nháp hiện có (CHỈ TÌM STATUS = 'draft')
  SELECT id, attempt_number, reward_applied_at 
  INTO v_submission_id, v_attempt_num, v_already_applied
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status = 'draft'
  ORDER BY attempt_number DESC LIMIT 1;

  -- 1.4 Kiểm tra sự xuất hiện của file_url trong p_answers
  FOR v_ans_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    IF (v_ans_item->>'file_url') IS NOT NULL AND length(trim(v_ans_item->>'file_url')) > 0 THEN
      v_has_any_file := TRUE;
    END IF;
  END LOOP;

  -- NẾU CÓ FILE MÀ V_SUBMISSION_ID KHÔNG TỒN TẠI TỪ BEFORE DRAFT -> TỪ CHỐI NGAY TẠI PHASE 1!
  IF v_has_any_file AND v_submission_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa có bản nháp bài làm (submission_id). Bé cần khởi tạo lượt làm trước khi tải file.');
  END IF;

  IF v_submission_id IS NULL THEN
    SELECT status INTO v_latest_status
    FROM public.academic_submissions
    WHERE exercise_id = p_exercise_id AND student_id = v_student_id
    ORDER BY attempt_number DESC LIMIT 1;

    SELECT COUNT(*) INTO v_existing_attempts
    FROM public.academic_submissions
    WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft';

    IF v_existing_attempts >= COALESCE(v_ex.max_attempts, 1) AND v_latest_status != 'revision_requested' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bé đã dùng hết số lượt nộp bài cho phép.');
    END IF;

    SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_attempt_num
    FROM public.academic_submissions
    WHERE exercise_id = p_exercise_id AND student_id = v_student_id;
  END IF;

  -- 1.5 Thống kê số lượng câu hỏi của bài tập
  SELECT COUNT(*) INTO v_total_questions_count FROM public.academic_exercise_questions WHERE exercise_id = p_exercise_id;

  -- 1.6 Nếu nộp chính thức (p_is_draft = false) -> BẮT BỘC gửi đủ câu hỏi duy nhất
  IF NOT p_is_draft AND jsonb_array_length(p_answers) != v_total_questions_count THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn phải trả lời đầy đủ chính xác tất cả câu hỏi trước khi nộp bài chính thức.');
  END IF;

  -- 1.7 Kiểm tra từng câu trả lời trong p_answers VÀ xác minh file Storage & Options JSON DB
  FOR v_ans_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    BEGIN
      v_curr_q_id := (v_ans_item->>'question_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ question_id không đúng định dạng UUID.');
    END;

    IF v_curr_q_id = ANY(v_seen_q_ids) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id bị gửi trùng lặp.');
    END IF;
    v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

    SELECT * INTO v_q FROM public.academic_exercise_questions WHERE id = v_curr_q_id AND exercise_id = p_exercise_id;
    IF v_q.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id không thuộc bài tập này.');
    END IF;

    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    -- Đánh giá theo loại câu hỏi và ĐỐI CHIẾU THỰC TẾ VỚI OPTIONS_JSON TRONG CSDL
    IF v_q.question_type = 'single_choice' THEN
      IF jsonb_typeof(v_q.options_json) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc options_json câu hỏi trắc nghiệm trong CSDL không phải mảng JSON.');
      END IF;

      IF NOT p_is_draft AND (v_student_ans IS NULL OR jsonb_typeof(v_student_ans) = 'null') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn đáp án trắc nghiệm.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu hỏi trắc nghiệm đơn phải là một chuỗi chữ.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) = 'string' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_q.options_json) opt WHERE opt = (v_student_ans#>>'{}')
        ) INTO v_opt_match;
        IF NOT v_opt_match THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án trắc nghiệm đơn được chọn không thuộc danh sách lựa chọn của câu hỏi.');
        END IF;
      END IF;

    ELSIF v_q.question_type = 'multiple_choice' THEN
      IF jsonb_typeof(v_q.options_json) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc options_json câu hỏi trắc nghiệm trong CSDL không phải mảng JSON.');
      END IF;

      IF NOT p_is_draft AND (v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'array' OR jsonb_array_length(v_student_ans) = 0) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn đáp án cho câu hỏi trắc nghiệm nhiều lựa chọn.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu hỏi nhiều lựa chọn phải là một mảng JSON.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) = 'array' THEN
        SELECT COUNT(DISTINCT elem) INTO v_distinct_count FROM jsonb_array_elements_text(v_student_ans) elem;
        IF v_distinct_count != jsonb_array_length(v_student_ans) THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu hỏi trắc nghiệm nhiều lựa chọn không được chứa các phần tử trùng lặp.');
        END IF;

        SELECT NOT EXISTS (
          SELECT elem FROM jsonb_array_elements_text(v_student_ans) elem
          WHERE elem NOT IN (SELECT jsonb_array_elements_text(v_q.options_json))
        ) INTO v_opt_match;
        IF NOT v_opt_match THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện lựa chọn trong câu trắc nghiệm không thuộc danh sách lựa chọn hợp lệ.');
        END IF;
      END IF;

    ELSIF v_q.question_type IN ('fill_blank', 'short_answer') THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu trả lời ngắn phải là một chuỗi chữ.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa nhập câu trả lời điền đáp án.');
        END IF;
      END IF;
      IF v_student_ans IS NOT NULL AND length(v_student_ans#>>'{}') > 2000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu trả lời ngắn vượt quá giới hạn 2.000 ký tự.');
      END IF;

    ELSIF v_q.question_type = 'essay' THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài làm tự luận phải là một chuỗi văn bản.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa viết bài làm tự luận.');
        END IF;
      END IF;
      IF v_student_ans IS NOT NULL AND length(v_student_ans#>>'{}') > 20000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài làm tự luận vượt quá giới hạn 20.000 ký tự.');
      END IF;
    END IF;

    -- Kiểm tra câu hỏi nộp file / ảnh
    IF v_q.question_type IN ('image_upload', 'file_upload') THEN
      IF NOT p_is_draft AND (v_file_url IS NULL OR length(trim(v_file_url)) = 0) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn file hoặc ảnh bài làm để nộp.');
      END IF;

      IF v_file_url IS NOT NULL AND length(trim(v_file_url)) > 0 THEN
        IF v_submission_id IS NULL OR NOT (
          v_file_url LIKE v_student_id::text || '/' || v_submission_id::text || '/%'
          OR v_file_url LIKE 'students/' || v_student_id::text || '/submissions/' || v_submission_id::text || '/%'
        ) THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đường dẫn file nộp không đúng cấu trúc thư mục của học sinh.');
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM storage.objects 
          WHERE bucket_id = 'exercise-submissions' AND name = v_file_url
        ) INTO v_file_exists;

        IF NOT v_file_exists THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: File bài làm đã khai báo không tồn tại thực tế trên hệ thống Storage.');
        END IF;
      END IF;
    ELSE
      -- Câu hỏi không phải nộp file -> TUYỆT ĐỐI KHÔNG gửi kèm file_url
      IF v_file_url IS NOT NULL AND length(trim(v_file_url)) > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ file_url chỉ dành riêng cho loại câu hỏi nộp ảnh hoặc file.');
      END IF;
    END IF;

  END LOOP;

  -- =========================================================================
  -- PHASE 2: DML EXECUTION PHASE (CHỈ THỰC THI KHI 100% VALIDATION PHASE THÀNH CÔNG)
  -- =========================================================================
  IF v_submission_id IS NULL THEN
    v_status := CASE WHEN p_is_draft THEN 'draft' ELSE 'submitted' END;
    INSERT INTO public.academic_submissions (
      exercise_id, student_id, attempt_number, status, max_score
    ) VALUES (
      p_exercise_id, v_student_id, v_attempt_num, v_status, 100
    ) RETURNING id INTO v_submission_id;
  ELSE
    v_status := CASE WHEN p_is_draft THEN 'draft' ELSE 'submitted' END;
    UPDATE public.academic_submissions
    SET status = v_status, updated_at = NOW()
    WHERE id = v_submission_id AND status = 'draft';
  END IF;

  -- Chỉ xóa câu trả lời của chính bản nháp hiện tại (v_submission_id), không ảnh hưởng attempt cũ
  DELETE FROM public.academic_submission_answers WHERE submission_id = v_submission_id;

  FOR v_q IN SELECT * FROM public.academic_exercise_questions WHERE exercise_id = p_exercise_id ORDER BY question_number ASC
  LOOP
    v_max_score := v_max_score + COALESCE(v_q.points, 10);
    
    SELECT value INTO v_ans_item 
    FROM jsonb_array_elements(p_answers) 
    WHERE (value->>'question_id')::UUID = v_q.id;

    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    v_is_correct := FALSE;
    v_points_earned := 0;

    IF v_q.question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer') THEN
      SELECT * INTO v_key FROM app_private.academic_answer_keys WHERE question_id = v_q.id;

      IF v_key.question_id IS NOT NULL AND v_student_ans IS NOT NULL THEN
        IF v_q.question_type = 'single_choice' THEN
          IF (v_student_ans#>>'{}') = (v_key.correct_answer#>>'{}') THEN
            v_is_correct := TRUE;
          END IF;

        ELSIF v_q.question_type = 'multiple_choice' THEN
          IF (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(v_student_ans) elem) =
             (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(v_key.correct_answer) elem) THEN
            v_is_correct := TRUE;
          END IF;

        ELSIF v_q.question_type IN ('fill_blank', 'short_answer') THEN
          IF v_key.case_sensitive THEN
            IF TRIM(v_student_ans#>>'{}') = TRIM(v_key.correct_answer#>>'{}')
               OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_key.accepted_answers) acc WHERE TRIM(acc) = TRIM(v_student_ans#>>'{}')) THEN
              v_is_correct := TRUE;
            END IF;
          ELSE
            IF LOWER(TRIM(v_student_ans#>>'{}')) = LOWER(TRIM(v_key.correct_answer#>>'{}'))
               OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_key.accepted_answers) acc WHERE LOWER(TRIM(acc)) = LOWER(TRIM(v_student_ans#>>'{}'))) THEN
              v_is_correct := TRUE;
            END IF;
          END IF;
        END IF;
      END IF;

      IF v_is_correct THEN
        v_points_earned := COALESCE(v_q.points, 10);
        v_obj_score := v_obj_score + v_points_earned;
      END IF;

    ELSE
      v_has_subjective := TRUE;
    END IF;

    INSERT INTO public.academic_submission_answers (
      submission_id, question_id, student_answer_json, file_url, points_earned, is_correct
    ) VALUES (
      v_submission_id, v_q.id, v_student_ans, v_file_url, v_points_earned, v_is_correct
    );
  END LOOP;

  IF NOT p_is_draft THEN
    IF v_has_subjective THEN
      v_status := 'pending_manual_grade';
    ELSE
      v_status := 'graded';
      IF v_max_score > 0 AND v_obj_score > 0 THEN
        v_ratio := (v_obj_score::FLOAT / v_max_score::FLOAT);
        v_reward_stars := FLOOR(COALESCE(v_ex.reward_stars, 10) * v_ratio);
      ELSE
        v_reward_stars := 0;
      END IF;
    END IF;
  END IF;

  UPDATE public.academic_submissions
  SET
    status = v_status,
    objective_score = v_obj_score,
    total_score = v_obj_score,
    max_score = GREATEST(v_max_score, 10),
    submitted_at = CASE WHEN NOT p_is_draft THEN NOW() ELSE submitted_at END,
    graded_at = CASE WHEN v_status = 'graded' THEN NOW() ELSE NULL END,
    reward_stars_awarded = CASE WHEN v_status = 'graded' AND v_already_applied IS NULL THEN v_reward_stars ELSE reward_stars_awarded END,
    reward_applied_at = CASE WHEN v_status = 'graded' AND v_reward_stars > 0 AND v_already_applied IS NULL THEN NOW() ELSE reward_applied_at END
  WHERE id = v_submission_id;

  IF v_status = 'graded' AND v_reward_stars > 0 AND v_already_applied IS NULL THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_reward_stars
    WHERE id = v_student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id,
    'attempt_number', v_attempt_num,
    'status', v_status,
    'objective_score', v_obj_score,
    'max_score', v_max_score,
    'reward_stars_awarded', CASE WHEN v_status = 'graded' AND v_already_applied IS NULL THEN v_reward_stars ELSE 0 END,
    'message', CASE WHEN p_is_draft THEN 'Đã lưu bản nháp thành công!' WHEN v_status = 'graded' THEN 'Nộp bài và tự động chấm điểm thành công!' ELSE 'Đã nộp bài thành công! Bài tập đang chờ Giáo viên chấm tự luận.' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_academic_exercise(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_academic_exercise(UUID, JSONB, BOOLEAN) TO authenticated, service_role;
