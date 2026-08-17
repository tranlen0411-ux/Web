-- ============================================================================
-- MIGRATION: QUY TRÌNH NHẬP DANH SÁCH LỚP 2.12 VÀO SUPABASE CSDL
-- AN TOÀN, IDEMPOTENT, CHỐNG TẠO TRÙNG VÀ BÁO CÁO CHI TIẾT KHI CHẠY DUYỆT
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. BẢNG TẠM CHỨA KẾT QUẢ BÁO CÁO ĐỐI CHIẾU DỮ LIỆU
CREATE TEMP TABLE IF NOT EXISTS temp_import_report (
  stt INT,
  input_name TEXT,
  status TEXT,
  matched_student_id UUID,
  current_class_name TEXT,
  note TEXT
) ON COMMIT DROP;

DO $$
DECLARE
  v_teacher_name_norm TEXT := 'lã nguyễn diễm hương';
  v_teacher_id UUID := NULL;
  v_teacher_count INT := 0;
  v_teacher_full_name TEXT;
  v_teacher_email TEXT;
  
  v_class_name TEXT := 'Lớp 2.12';
  v_grade_level INT := 2;
  v_class_id UUID := NULL;
  v_class_is_new BOOLEAN := FALSE;
  v_class_code TEXT;

  v_student_names TEXT[] := ARRAY[
    'Trần Lê Hoàng An',
    'Đỗ Hoài Anh',
    'Nguyễn Đình Ân',
    'Hà Gia Bảo',
    'Phạm Ngọc Minh Châu',
    'Nguyễn Công Minh Dương',
    'Nguyễn Võ Khả Hân',
    'Huỳnh Minh Hùng',
    'Phạm Bùi Bảo Khang',
    'Nguyễn Ngọc An Khánh',
    'Nguyễn Phúc Đăng Khoa',
    'Nguyễn Minh Khôi',
    'Nguyễn Trung Kiên',
    'Phạm Thị Hoàng Lâm',
    'Võ Thiên Long',
    'Trần Thị Quỳnh Mai',
    'Lê Thị Tú My',
    'Trần Ngọc Nga',
    'Trần Thị Kim Ngọc',
    'Võ Nguyễn Đăng Nguyên',
    'Nguyễn Ngọc Yến Nhi',
    'Nguyễn Thanh Nhi',
    'Nguyễn An Nhiên',
    'Võ Bảo Như',
    'Lưu Đình Tấn Phát',
    'Nguyễn Trần Mạnh Phi',
    'Nguyễn Ngọc An Phúc',
    'Nguyễn Thanh Phúc',
    'Nguyễn Trí Phúc',
    'Huỳnh Trương Tiến Thành',
    'Hồ Lê Trường Thịnh',
    'Phan Ngọc Bảo Trâm',
    'Phạm Đỗ Anh Tú',
    'Đặng Yến Vy'
  ];

  v_name TEXT;
  v_idx INT := 0;
  v_norm_name TEXT;
  v_matching_count INT;
  v_matched_id UUID;
  v_existing_class_id UUID;
  v_existing_class_name TEXT;
  v_added_count INT := 0;
  v_already_in_212 INT := 0;
  v_in_other_class INT := 0;
  v_no_account INT := 0;
  v_duplicate_name INT := 0;
BEGIN
  -- =========================================================================
  -- BƯỚC I: XÁC ĐỊNH GIÁO VIÊN "Lã Nguyễn Diễm Hương"
  -- =========================================================================
  SELECT COUNT(*), MAX(id), MAX(full_name), MAX(email)
  INTO v_teacher_count, v_teacher_id, v_teacher_full_name, v_teacher_email
  FROM public.profiles
  WHERE role = 'teacher'
    AND LOWER(TRIM(regexp_replace(full_name, '\s+', ' ', 'g'))) = v_teacher_name_norm;

  IF v_teacher_count = 0 THEN
    RAISE EXCEPTION 'MIGRATION BỊ DỪNG: Không tìm thấy hồ sơ Giáo viên "Lã Nguyễn Diễm Hương" (role = teacher) trong bảng public.profiles.';
  ELSIF v_teacher_count > 1 THEN
    RAISE EXCEPTION 'MIGRATION BỊ DỪNG: Phát hiện % hồ sơ Giáo viên trùng tên "Lã Nguyễn Diễm Hương". Cần xác minh ID thủ công trước khi gán lớp.', v_teacher_count;
  END IF;

  RAISE NOTICE 'XÁC NHẬN GIÁO VIÊN DUY NHẤT: ID=%, Name="%", Email=%', v_teacher_id, v_teacher_full_name, v_teacher_email;

  -- =========================================================================
  -- BƯỚC II: TẠO HOẶC TÁI SỬ DỤNG LỚP 2.12
  -- =========================================================================
  SELECT id INTO v_class_id
  FROM public.classes
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_class_name))
    AND grade_level = v_grade_level;

  IF v_class_id IS NOT NULL THEN
    v_class_is_new := FALSE;
    -- Cập nhật teacher_id đúng cho Giáo viên Lã Nguyễn Diễm Hương nếu chưa gán
    UPDATE public.classes
    SET teacher_id = v_teacher_id
    WHERE id = v_class_id AND teacher_id IS DISTINCT FROM v_teacher_id;
    RAISE NOTICE 'TÁI SỬ DỤNG LỚP ĐÃ TỒN TẠI: Class ID=%', v_class_id;
  ELSE
    v_class_is_new := TRUE;
    v_class_code := 'LOP212-' || UPPER(SUBSTRING(md5(random()::text) FROM 1 FOR 6));
    
    INSERT INTO public.classes (name, grade_level, code, teacher_id)
    VALUES (v_class_name, v_grade_level, v_class_code, v_teacher_id)
    RETURNING id INTO v_class_id;

    RAISE NOTICE 'TẠO MỚI LỚP 2.12 THÀNH CÔNG: Class ID=%, Code=%', v_class_id, v_class_code;
  END IF;

  -- =========================================================================
  -- BƯỚC III: ĐỐI CHIẾU VÀ PHÂN LOẠI 34 HỌC SINH
  -- =========================================================================
  FOREACH v_name IN ARRAY v_student_names
  LOOP
    v_idx := v_idx + 1;
    v_norm_name := LOWER(TRIM(regexp_replace(v_name, '\s+', ' ', 'g')));

    -- Đếm số profile học sinh trùng tên chuẩn hóa
    SELECT COUNT(*), MAX(id)
    INTO v_matching_count, v_matched_id
    FROM public.profiles
    WHERE role = 'student'
      AND LOWER(TRIM(regexp_replace(full_name, '\s+', ' ', 'g'))) = v_norm_name;

    IF v_matching_count = 0 THEN
      -- Trường hợp 1: Chưa có tài khoản profile
      v_no_account := v_no_account + 1;
      INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_class_name, note)
      VALUES (v_idx, v_name, 'CHƯA_CÓ_TÀI_KHOẢN', NULL, NULL, 'Cần tạo tài khoản qua Auth/RPC trước');

    ELSIF v_matching_count > 1 THEN
      -- Trường hợp 2: Có nhiều profile trùng tên
      v_duplicate_name := v_duplicate_name + 1;
      INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_class_name, note)
      VALUES (v_idx, v_name, 'TRÙNG_TÊN_NỀN_TẢNG', NULL, NULL, 'Có ' || v_matching_count || ' tài khoản trùng tên, cần xác minh ID');

    ELSE
      -- Trường hợp 3: Khớp duy nhất 1 profile -> Kiểm tra lớp hiện tại trong class_members
      SELECT cm.class_id, c.name
      INTO v_existing_class_id, v_existing_class_name
      FROM public.class_members cm
      JOIN public.classes c ON c.id = cm.class_id
      WHERE cm.student_id = v_matched_id
      ORDER BY cm.joined_at DESC
      LIMIT 1;

      IF v_existing_class_id IS NULL THEN
        -- Học sinh chưa thuộc lớp nào -> Đủ điều kiện thêm vào Lớp 2.12
        INSERT INTO public.class_members (class_id, student_id, joined_at)
        VALUES (v_class_id, v_matched_id, NOW())
        ON CONFLICT (class_id, student_id) DO NOTHING;

        v_added_count := v_added_count + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_class_name, note)
        VALUES (v_idx, v_name, 'ĐỦ_ĐIỀU_KIỆN_ĐÃ_THÊM', v_matched_id, 'Chưa có lớp', 'Đã gán vào Lớp 2.12 thành công');

      ELSIF v_existing_class_id = v_class_id THEN
        -- Học sinh đã thuộc chính Lớp 2.12 từ trước
        v_already_in_212 := v_already_in_212 + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_class_name, note)
        VALUES (v_idx, v_name, 'ĐÃ_Ở_TRONG_LỚP_2.12', v_matched_id, v_existing_class_name, 'Giữ nguyên thành viên Lớp 2.12');

      ELSE
        -- Học sinh đang thuộc lớp khác -> Không tự chuyển, đưa vào báo cáo
        v_in_other_class := v_in_other_class + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_class_name, note)
        VALUES (v_idx, v_name, 'ĐANG_THUỘC_LỚP_KHÁC', v_matched_id, v_existing_class_name, 'Cần duyệt chuyển từ ' || v_existing_class_name || ' sang Lớp 2.12');
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'TỔNG HỢP KẾT QUẢ ĐỐI CHIẾU NHẬP LỚP 2.12:';
  RAISE NOTICE ' - Giáo viên tìm thấy: 1/1 (ID: %, Name: "%")', v_teacher_id, v_teacher_full_name;
  RAISE NOTICE ' - Lớp 2.12: % (ID: %)', CASE WHEN v_class_is_new THEN 'TẠO MỚI' ELSE 'TÁI SỬ DỤNG LỚP ĐÃ CÓ' END, v_class_id;
  RAISE NOTICE ' - Tổng danh sách học sinh: 34';
  RAISE NOTICE ' - Học sinh đủ điều kiện đã thêm vào Lớp 2.12: %', v_added_count;
  RAISE NOTICE ' - Học sinh đã ở sẵn trong Lớp 2.12: %', v_already_in_212;
  RAISE NOTICE ' - Học sinh đang thuộc lớp khác (không tự đổi): %', v_in_other_class;
  RAISE NOTICE ' - Học sinh chưa có tài khoản profile: %', v_no_account;
  RAISE NOTICE ' - Học sinh trùng tên cần xác minh: %', v_duplicate_name;
  RAISE NOTICE '=======================================================';
END $$;

-- DISPLAY REPORT TABLE FOR USER REVIEW IN SUPABASE SQL EDITOR
SELECT 
  stt AS "STT",
  input_name AS "Họ và Tên Học Sinh",
  status AS "Trạng Thái Đối Chiếu",
  matched_student_id AS "UUID Hồ Sơ",
  COALESCE(current_class_name, '-') AS "Lớp Hiện Tại",
  note AS "Ghi Chú & Hướng Xử Lý"
FROM temp_import_report
ORDER BY stt ASC;

COMMIT;
