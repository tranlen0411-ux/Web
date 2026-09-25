-- ============================================================================
-- MIGRATION: MULTI-ATTEMPT DEADLINE RESUBMISSION & REWARD DUPLICATION SAFETY
-- Version: 20260924000002
-- Mục tiêu:
-- 1. Sửa lỗi Deadline: Cho phép học sinh làm lại (resubmission) sau due_date khi và chỉ khi
--    bài nộp gần nhất của chính học sinh đó có trạng thái 'revision_requested'.
--    Các lượt làm bình thường hoặc các trạng thái khác sau due_date tiếp tục bị chặn nghiêm ngặt.
-- 2. Sửa lỗi Duplicate Reward Stars: Chuyển guard cộng sao từ per-submission sang
--    per student + exercise (First Rewarded Attempt Wins). Ngăn chặn tuyệt đối việc học sinh
--    nhận thêm sao trùng lặp cho cùng một bài tập ở các attempt sau khi đã nhận sao ở attempt trước.
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

  -- KIỂM TRA HẠN NỘP (DUE_DATE): Chỉ cho phép vượt quá due_date nếu bài gần nhất của học sinh có status = 'revision_requested'
  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    IF v_latest_status IS DISTINCT FROM 'revision_requested' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Đã quá hạn làm bài tập này.');
    END IF;
  END IF;

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
  v_already_rewarded_for_exercise BOOLEAN := FALSE;
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

  -- Tìm trạng thái của submission gần nhất trước đó (khác draft)
  SELECT status INTO v_latest_status
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft'
  ORDER BY attempt_number DESC LIMIT 1;

  -- KIỂM TRA HẠN NỘP (DUE_DATE): Chỉ cho phép nộp quá due_date nếu bài gần nhất trước đó có status = 'revision_requested'
  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    IF v_latest_status IS DISTINCT FROM 'revision_requested' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đã quá hạn nộp bài tập này.');
    END IF;
  END IF;

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
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu hỏi ' || v_curr_q_id::text || ' không thuộc bài tập này.');
    END IF;

    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    IF v_q.question_type = 'single_choice' THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu trắc nghiệm đơn phải là chuỗi văn bản.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn đáp án trắc nghiệm.');
        END IF;
      END IF;

      IF v_student_ans IS NOT NULL AND length(trim(v_student_ans#>>'{}')) > 0 THEN
        IF v_q.options_json IS NOT NULL AND jsonb_typeof(v_q.options_json) = 'array' AND jsonb_array_length(v_q.options_json) > 0 THEN
          SELECT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_q.options_json) opt WHERE opt = (v_student_ans#>>'{}')
          ) INTO v_opt_match;
          IF NOT v_opt_match THEN
            RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án đã chọn không nằm trong danh sách lựa chọn của câu hỏi.');
          END IF;
        END IF;
      END IF;

    ELSIF v_q.question_type = 'multiple_choice' THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu nhiều lựa chọn phải là một mảng JSON.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'array' OR jsonb_array_length(v_student_ans) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn đáp án cho câu hỏi nhiều lựa chọn.');
        END IF;
      END IF;

      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) = 'array' AND jsonb_array_length(v_student_ans) > 0 THEN
        SELECT COUNT(DISTINCT elem) INTO v_distinct_count FROM jsonb_array_elements_text(v_student_ans) elem;
        IF v_distinct_count != jsonb_array_length(v_student_ans) THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện đáp án bị chọn trùng lặp trong câu nhiều lựa chọn.');
        END IF;

        IF v_q.options_json IS NOT NULL AND jsonb_typeof(v_q.options_json) = 'array' AND jsonb_array_length(v_q.options_json) > 0 THEN
          SELECT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_student_ans) ans_elem
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(v_q.options_json) opt WHERE opt = ans_elem
            )
          ) INTO v_opt_match;
          IF v_opt_match THEN
            RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Một trong các đáp án đã chọn không hợp lệ.');
          END IF;
        END IF;
      END IF;

    ELSIF v_q.question_type = 'fill_blank' THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án điền khuyết phải là một chuỗi văn bản.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa điền câu trả lời vào ô trống.');
        END IF;
      END IF;
      IF v_student_ans IS NOT NULL AND length(v_student_ans#>>'{}') > 2000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu trả lời điền khuyết vượt quá giới hạn 2.000 ký tự.');
      END IF;

    ELSIF v_q.question_type = 'short_answer' THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu trả lời ngắn phải là một chuỗi văn bản.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa nhập câu trả lời ngắn.');
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

  -- KIỂM TRA REWARD GUARD: PER STUDENT + EXERCISE (FIRST REWARDED ATTEMPT WINS)
  SELECT EXISTS (
    SELECT 1 FROM public.academic_submissions
    WHERE exercise_id = p_exercise_id
      AND student_id = v_student_id
      AND reward_applied_at IS NOT NULL
      AND id != v_submission_id
  ) INTO v_already_rewarded_for_exercise;

  IF v_already_rewarded_for_exercise THEN
    v_reward_stars := 0;
  END IF;

  UPDATE public.academic_submissions
  SET
    status = v_status,
    objective_score = v_obj_score,
    total_score = v_obj_score,
    max_score = GREATEST(v_max_score, 10),
    submitted_at = CASE WHEN NOT p_is_draft THEN NOW() ELSE submitted_at END,
    graded_at = CASE WHEN v_status = 'graded' THEN NOW() ELSE NULL END,
    reward_stars_awarded = CASE WHEN v_status = 'graded' AND NOT v_already_rewarded_for_exercise AND v_already_applied IS NULL THEN v_reward_stars ELSE 0 END,
    reward_applied_at = CASE WHEN v_status = 'graded' AND v_reward_stars > 0 AND NOT v_already_rewarded_for_exercise AND v_already_applied IS NULL THEN NOW() ELSE reward_applied_at END
  WHERE id = v_submission_id;

  IF v_status = 'graded' AND v_reward_stars > 0 AND NOT v_already_rewarded_for_exercise AND v_already_applied IS NULL THEN
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
    'reward_stars_awarded', CASE WHEN v_status = 'graded' AND NOT v_already_rewarded_for_exercise AND v_already_applied IS NULL THEN v_reward_stars ELSE 0 END,
    'message', CASE WHEN p_is_draft THEN 'Đã lưu bản nháp thành công!' WHEN v_status = 'graded' THEN 'Nộp bài và tự động chấm điểm thành công!' ELSE 'Đã nộp bài thành công! Bài tập đang chờ Giáo viên chấm tự luận.' END
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. RPC: finalize_academic_submission_grading_with_annotations
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_academic_submission_grading_with_annotations(
  p_submission_id uuid,
  p_manual_grades jsonb,
  p_annotations jsonb DEFAULT '[]'::jsonb,
  p_teacher_feedback text DEFAULT '',
  p_request_revision boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_ann_item JSONB;
  v_grade_item JSONB;
  v_att_id UUID;
  v_ann_json JSONB;
  v_raw_idemp TEXT;
  v_idemp UUID;
  v_exp_ver INT;
  v_cur_ver INT;
  v_new_ver INT;
  v_existing_idemp RECORD;
  v_has_idemp_record BOOLEAN;
  v_seen_att_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_q_type TEXT;
  v_q_points NUMERIC(6,2);
  v_item_points NUMERIC(6,2);
  v_total_manual NUMERIC(6,2) := 0.00;
  v_final_total NUMERIC(6,2) := 0.00;
  v_new_status TEXT;
  v_stars_to_award INT := 0;
  v_ratio FLOAT := 0.0;
  v_already_rewarded_for_exercise BOOLEAN := FALSE;
  v_ex_id UUID;
  v_st_id UUID;
BEGIN
  v_teacher_id := auth.uid();
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;
  IF v_role NOT IN ('teacher', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi: Chỉ Giáo viên hoặc Admin mới có quyền chấm bài.');
  END IF;

  -- 1. Lấy target exercise_id + student_id để tạo advisory lock key
  SELECT exercise_id, student_id INTO v_ex_id, v_st_id
  FROM public.academic_submissions WHERE id = p_submission_id;

  IF v_ex_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- 2. Khóa advisory transaction chống race condition chấm đồng thời nhiều attempt hoặc cùng 1 bài nộp
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || v_ex_id::text || '_' || v_st_id::text));

  -- 3. Đọc lại trạng thái bài nộp authoritative từ database SAU KHI ĐÃ SERIALIZE
  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- 4. Kiểm tra lại trạng thái bài nộp (phải là submitted hoặc pending_manual_grade)
  IF v_sub.status NOT IN ('submitted', 'pending_manual_grade') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Lỗi: Chỉ được chấm bài nộp ở trạng thái submitted hoặc pending_manual_grade.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- CHECK PHÂN QUYỀN
  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) THEN
    v_has_permission := TRUE;
  ELSIF v_ex.class_id IS NOT NULL
    AND app_private.teacher_owns_class(v_ex.class_id)
    AND EXISTS (
      SELECT 1 FROM public.class_members cm
      WHERE cm.class_id = v_ex.class_id AND cm.student_id = v_sub.student_id
    ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi: Bạn không có quyền chấm bài nộp của học sinh này.');
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. XỬ LÝ ANNOTATIONS
  -- --------------------------------------------------------------------------
  IF p_annotations IS NOT NULL AND jsonb_typeof(p_annotations) = 'array' THEN
    -- PASS 1: VALIDATION LOOP (Pre-flight checks, OCC & Idempotency validation)
    FOR v_ann_item IN SELECT * FROM jsonb_array_elements(p_annotations)
    LOOP
      -- A. Validate attachment_id format
      BEGIN
        v_att_id := (v_ann_item->>'attachment_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTACHMENT_ID', 'message', 'Lỗi: attachment_id không đúng định dạng UUID.');
      END;

      IF v_att_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTACHMENT_ID', 'message', 'Lỗi: attachment_id không được để trống.');
      END IF;

      -- B. Chống trùng lặp attachment_id trong cùng một payload
      IF v_att_id = ANY(v_seen_att_ids) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_ATTACHMENT', 'message', format('Lỗi: Trùng lặp attachment_id %s trong payload.', v_att_id));
      END IF;
      v_seen_att_ids := array_append(v_seen_att_ids, v_att_id);

      -- C. Validate attachment ownership / binding với submission_id
      IF NOT EXISTS (
        SELECT 1 FROM public.academic_submission_attachments
        WHERE id = v_att_id AND submission_id = p_submission_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTACHMENT_MISMATCH', 'message', format('Lỗi: Attachment %s không thuộc bài nộp này.', v_att_id));
      END IF;

      -- D. Validate annotation_json structure
      v_ann_json := v_ann_item->'annotation_json';
      IF v_ann_json IS NULL OR jsonb_typeof(v_ann_json) != 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ANNOTATION_PAYLOAD', 'message', 'Lỗi: annotation_json phải là một JSON object.');
      END IF;

      -- E. Validate idempotency_key format
      v_raw_idemp := NULLIF(TRIM(v_ann_item->>'idempotency_key'), '');
      IF v_raw_idemp IS NOT NULL THEN
        BEGIN
          v_idemp := v_raw_idemp::UUID;
        EXCEPTION WHEN OTHERS THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_IDEMPOTENCY_KEY', 'message', 'Lỗi: idempotency_key không đúng định dạng UUID.');
        END;
      ELSE
        v_idemp := NULL;
      END IF;

      -- F. Idempotency record check & collision detection
      v_has_idemp_record := FALSE;
      IF v_idemp IS NOT NULL THEN
        SELECT id, attachment_id, submission_id INTO v_existing_idemp
        FROM public.academic_submission_annotation_versions
        WHERE teacher_id = v_teacher_id AND idempotency_key = v_idemp;

        IF v_existing_idemp.id IS NOT NULL THEN
          v_has_idemp_record := TRUE;
          IF v_existing_idemp.attachment_id <> v_att_id OR v_existing_idemp.submission_id <> p_submission_id THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'IDEMPOTENCY_KEY_MISMATCH',
              'message', format('Lỗi: Idempotency key %s đã được sử dụng cho attachment/submission khác.', v_idemp)
            );
          END IF;
        END IF;
      END IF;

      -- G. Validate expected_version
      IF v_ann_item ? 'expected_version' AND v_ann_item->>'expected_version' IS NOT NULL AND TRIM(v_ann_item->>'expected_version') <> '' THEN
        BEGIN
          v_exp_ver := (v_ann_item->>'expected_version')::INT;
        EXCEPTION WHEN OTHERS THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_EXPECTED_VERSION', 'message', 'Lỗi: expected_version không hợp lệ.');
        END;
      ELSE
        v_exp_ver := NULL;
      END IF;

      -- H. Optimistic Concurrency Control (OCC)
      IF NOT v_has_idemp_record THEN
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
      END IF;
    END LOOP;

    -- PASS 2: EXECUTION / INSERTION LOOP
    FOR v_ann_item IN SELECT * FROM jsonb_array_elements(p_annotations)
    LOOP
      v_att_id := (v_ann_item->>'attachment_id')::UUID;
      v_ann_json := v_ann_item->'annotation_json';
      v_raw_idemp := NULLIF(TRIM(v_ann_item->>'idempotency_key'), '');

      IF v_raw_idemp IS NOT NULL THEN
        v_idemp := v_raw_idemp::UUID;

        IF EXISTS (
          SELECT 1 FROM public.academic_submission_annotation_versions
          WHERE teacher_id = v_teacher_id AND idempotency_key = v_idemp
        ) THEN
          CONTINUE;
        END IF;
      ELSE
        v_idemp := gen_random_uuid();
      END IF;

      SELECT COALESCE(MAX(version), 0) INTO v_cur_ver
      FROM public.academic_submission_annotation_versions
      WHERE attachment_id = v_att_id;

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
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. CHẤM ĐIỂM MANUAL_GRADES
  -- --------------------------------------------------------------------------
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
        teacher_comment = COALESCE(v_grade_item->>'teacher_comment', teacher_comment)
      WHERE submission_id = p_submission_id AND question_id = v_curr_q_id;

      v_total_manual := v_total_manual + v_item_points;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. CẬP NHẬT TỔNG ĐIỂM BÀI NỘP
  -- --------------------------------------------------------------------------
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

  -- --------------------------------------------------------------------------
  -- 4. THƯỞNG SAO HỌC SINH (PER STUDENT + EXERCISE GUARD)
  -- --------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM public.academic_submissions
    WHERE exercise_id = v_sub.exercise_id
      AND student_id = v_sub.student_id
      AND reward_applied_at IS NOT NULL
      AND id != p_submission_id
  ) INTO v_already_rewarded_for_exercise;

  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL AND NOT v_already_rewarded_for_exercise AND v_ex.reward_stars > 0 THEN
    IF v_sub.max_score > 0 THEN
      v_ratio := v_final_total::FLOAT / v_sub.max_score::FLOAT;
      IF v_ratio >= 0.5 THEN
        v_stars_to_award := ROUND(v_ex.reward_stars * v_ratio);
        IF v_stars_to_award > 0 THEN
          UPDATE public.profiles
          SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
          WHERE id = v_sub.student_id;

          UPDATE public.academic_submissions
          SET reward_applied_at = NOW(),
              reward_stars_awarded = v_stars_to_award
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
$function$;

-- ----------------------------------------------------------------------------
-- 4. RPC: grade_academic_submission (Legacy fallback)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grade_academic_submission(
  p_submission_id uuid,
  p_manual_grades jsonb DEFAULT '[]'::jsonb,
  p_teacher_feedback text DEFAULT '',
  p_request_revision boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_grade_item JSONB;
  v_curr_q_id UUID;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_q_type TEXT;
  v_q_points NUMERIC;
  v_item_points NUMERIC;
  v_num_val NUMERIC;
  v_total_manual NUMERIC := 0;
  v_final_total NUMERIC := 0;
  v_new_status TEXT;
  v_stars_to_award INT := 0;
  v_ratio FLOAT := 0.0;
  v_sub_ans_exists BOOLEAN := FALSE;
  v_total_subjective_count INT := 0;
  v_graded_subjective_count INT := 0;
  v_updated_rows INT := 0;
  v_already_rewarded_for_exercise BOOLEAN := FALSE;
  v_ex_id UUID;
  v_st_id UUID;
BEGIN
  v_teacher_id := auth.uid();
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;
  IF v_role NOT IN ('teacher', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ Giáo viên hoặc Admin mới có quyền chấm bài.');
  END IF;

  -- 1. Lấy target exercise_id + student_id để tạo advisory lock key
  SELECT exercise_id, student_id INTO v_ex_id, v_st_id
  FROM public.academic_submissions WHERE id = p_submission_id;

  IF v_ex_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- 2. Khóa advisory transaction chống race condition chấm đồng thời nhiều attempt hoặc cùng 1 bài nộp
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || v_ex_id::text || '_' || v_st_id::text));

  -- 3. Đọc lại trạng thái bài nộp authoritative từ database SAU KHI ĐÃ SERIALIZE
  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- 4. Kiểm tra lại trạng thái bài nộp (phải là submitted hoặc pending_manual_grade)
  IF v_sub.status NOT IN ('submitted', 'pending_manual_grade') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ được chấm bài nộp ở trạng thái submitted hoặc pending_manual_grade.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) THEN
    v_has_permission := TRUE;
  ELSIF v_ex.class_id IS NOT NULL
    AND app_private.teacher_owns_class(v_ex.class_id)
    AND EXISTS (
      SELECT 1 FROM public.class_members cm
      WHERE cm.class_id = v_ex.class_id AND cm.student_id = v_sub.student_id
    ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền chấm bài nộp này (Bạn không phụ trách lớp học của học sinh).');
  END IF;

  IF p_manual_grades IS NOT NULL THEN
    IF jsonb_typeof(p_manual_grades) != 'array' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc điểm chấm p_manual_grades phải là một mảng JSON.');
    END IF;

    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      BEGIN
        v_curr_q_id := (v_grade_item->>'question_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: question_id trong p_manual_grades không đúng định dạng UUID.');
      END;

      IF v_curr_q_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: question_id không được để trống.');
      END IF;

      IF v_curr_q_id = ANY(v_seen_q_ids) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Trùng lặp question_id ' || v_curr_q_id::text || ' trong danh sách chấm điểm.');
      END IF;
      v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

      SELECT question_type, points INTO v_q_type, v_q_points
      FROM public.academic_exercise_questions
      WHERE id = v_curr_q_id AND exercise_id = v_sub.exercise_id;

      IF v_q_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu hỏi ' || v_curr_q_id::text || ' không thuộc bài tập này.');
      END IF;

      IF v_q_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ được chấm điểm thủ công cho câu hỏi tự luận hoặc nộp file.');
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.academic_submission_answers
        WHERE submission_id = p_submission_id AND question_id = v_curr_q_id
      ) INTO v_sub_ans_exists;

      IF NOT v_sub_ans_exists THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Học sinh chưa nộp câu trả lời cho câu hỏi ' || v_curr_q_id::text || '.');
      END IF;

      BEGIN
        v_num_val := (v_grade_item->>'points_earned')::NUMERIC;
      EXCEPTION WHEN OTHERS THEN
        v_num_val := NULL;
      END;

      IF v_num_val IS NULL OR v_num_val < 0 OR v_num_val > COALESCE(v_q_points, 10) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm cho câu ' || v_curr_q_id::text || ' không hợp lệ, phải từ 0 đến ' || COALESCE(v_q_points, 10)::text || '.');
      END IF;

      v_item_points := v_num_val;
      v_total_manual := v_total_manual + v_item_points;
      v_graded_subjective_count := v_graded_subjective_count + 1;
    END LOOP;
  END IF;

  SELECT COUNT(*) INTO v_total_subjective_count
  FROM public.academic_exercise_questions
  WHERE exercise_id = v_sub.exercise_id AND question_type IN ('essay', 'image_upload', 'file_upload');

  IF NOT p_request_revision THEN
    IF v_graded_subjective_count < v_total_subjective_count THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn phải chấm đầy đủ điểm cho tất cả câu hỏi tự luận / nộp file trước khi chuyển trạng thái Đã Chấm (graded).');
    END IF;
  END IF;

  IF p_request_revision THEN
    v_new_status := 'revision_requested';
  ELSE
    v_new_status := 'graded';
  END IF;

  -- PHASE 2: DML EXECUTION
  IF p_manual_grades IS NOT NULL AND jsonb_array_length(p_manual_grades) > 0 THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      UPDATE public.academic_submission_answers
      SET points_earned = (v_grade_item->>'points_earned')::NUMERIC,
          teacher_comment = NULLIF(TRIM(v_grade_item->>'teacher_comment'), '')
      WHERE submission_id = p_submission_id
        AND question_id = (v_grade_item->>'question_id')::UUID;

      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows != 1 THEN
        RAISE EXCEPTION 'Chấm điểm thất bại: Không cập nhật được câu hỏi.';
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(ans.points_earned), 0) INTO v_total_manual
  FROM public.academic_submission_answers ans
  JOIN public.academic_exercise_questions q ON q.id = ans.question_id
  WHERE ans.submission_id = p_submission_id AND q.question_type IN ('essay', 'image_upload', 'file_upload');

  v_final_total := LEAST(COALESCE(v_sub.objective_score, 0) + v_total_manual, COALESCE(v_sub.max_score, 100));

  -- TÍNH TOÁN SAO THƯỞNG (PER STUDENT + EXERCISE GUARD)
  SELECT EXISTS (
    SELECT 1 FROM public.academic_submissions
    WHERE exercise_id = v_sub.exercise_id
      AND student_id = v_sub.student_id
      AND reward_applied_at IS NOT NULL
      AND id != p_submission_id
  ) INTO v_already_rewarded_for_exercise;

  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL AND NOT v_already_rewarded_for_exercise AND v_final_total > 0 THEN
    v_ratio := (v_final_total::FLOAT / COALESCE(v_sub.max_score, 100)::FLOAT);
    v_stars_to_award := FLOOR(COALESCE(v_ex.reward_stars, 10) * v_ratio);
  ELSE
    v_stars_to_award := 0;
  END IF;

  UPDATE public.academic_submissions
  SET status = v_new_status,
      manual_score = v_total_manual,
      total_score = v_final_total,
      teacher_feedback = NULLIF(TRIM(p_teacher_feedback), ''),
      graded_at = NOW(),
      graded_by = v_teacher_id,
      reward_stars_awarded = CASE WHEN v_sub.reward_applied_at IS NULL AND NOT v_already_rewarded_for_exercise THEN v_stars_to_award ELSE reward_stars_awarded END,
      reward_applied_at = CASE WHEN v_stars_to_award > 0 AND v_sub.reward_applied_at IS NULL AND NOT v_already_rewarded_for_exercise THEN NOW() ELSE reward_applied_at END
  WHERE id = p_submission_id;

  IF v_stars_to_award > 0 AND v_sub.reward_applied_at IS NULL AND NOT v_already_rewarded_for_exercise THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
    WHERE id = v_sub.student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'total_score', v_final_total,
    'stars_awarded', CASE WHEN v_sub.reward_applied_at IS NULL AND NOT v_already_rewarded_for_exercise THEN v_stars_to_award ELSE 0 END,
    'message', CASE 
      WHEN v_new_status = 'graded' THEN 'Đã chấm bài hoàn tất và trao thưởng thành công!'
      WHEN v_new_status = 'revision_requested' THEN 'Đã yêu cầu học sinh làm lại bài.'
      ELSE 'Đã lưu điểm thành phần.'
    END
  );
END;
$function$;
