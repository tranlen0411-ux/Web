-- ============================================================================
-- SCRIPT THỰC THI DỮ LIỆU: NHẬP DANH SÁCH LỚP 2.12 VÀ 34 HỌC SINH VÀO SUPABASE
-- LƯU Ý: ĐÂY LÀ SCRIPT THỰC THI CÓ GHI DỮ LIỆU HỢP LỆ (KHÔNG PHẢI PREFLIGHT THUẦN TÚY)
-- TỰ ĐỘNG ROLLBACK TOÀN BỘ TRANSACTION NẾU GIÁO VIÊN HOẶC LỚP HỌC KHÔNG HỢP LỆ
-- ĐÃ KHẮC PHỤC TRIỆT ĐỂ LỖI ERROR 42883: FUNCTION MAX(UUID) DOES NOT EXIST
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- BẢNG TẠM CHỨA BÁO CÁO KẾT QUẢ THỰC THI CHI TIẾT
CREATE TEMP TABLE IF NOT EXISTS temp_import_report (
  stt INT,
  input_name TEXT,
  status TEXT,
  matched_student_id UUID,
  current_classes TEXT,
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
  v_class_name_norm TEXT;
  v_grade_level INT := 2;
  v_matching_classes_count INT := 0;
  v_class_id UUID := NULL;
  v_class_is_new BOOLEAN := FALSE;
  v_class_code TEXT;
  v_code_exists BOOLEAN := TRUE;
  v_existing_teacher_id UUID;
  v_existing_teacher_name TEXT;

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
  v_matching_students_count INT;
  v_matched_id UUID;
  
  v_all_member_classes TEXT[];
  v_in_212 BOOLEAN;
  v_other_classes_count INT;
  v_classes_str TEXT;

  v_added_count INT := 0;
  v_already_in_212_only INT := 0;
  v_in_multiple_classes INT := 0;
  v_in_other_class INT := 0;
  v_no_account INT := 0;
  v_duplicate_name INT := 0;
BEGIN
  -- Chuẩn hóa tên lớp cần tìm (gộp mọi khoảng trắng thừa)
  v_class_name_norm := LOWER(TRIM(regexp_replace(v_class_name, '\s+', ' ', 'g')));

  -- =========================================================================
  -- BƯỚC I: XÁC ĐỊNH DUY NHẤT GIÁO VIÊN "Lã Nguyễn Diễm Hương"
  -- (KHÔNG DÙNG MAX(uuid) TRÁNH LỖI ERROR 42883 ON POSTGRES)
  -- =========================================================================
  -- Bước I.A: Đếm số lượng Giáo viên khớp tên
  SELECT COUNT(*)
  INTO v_teacher_count
  FROM public.profiles
  WHERE role = 'teacher'
    AND LOWER(TRIM(regexp_replace(full_name, '\s+', ' ', 'g'))) = v_teacher_name_norm;

  -- Kiểm tra số lượng kết quả
  IF v_teacher_count = 0 THEN
    RAISE EXCEPTION 'TRANSACTION ROLLBACK: Không tìm thấy hồ sơ Giáo viên "Lã Nguyễn Diễm Hương" (role = teacher) trong bảng public.profiles.';
  ELSIF v_teacher_count > 1 THEN
    RAISE EXCEPTION 'TRANSACTION ROLLBACK: Phát hiện % hồ sơ Giáo viên trùng tên "Lã Nguyễn Diễm Hương". Cần xác minh ID thủ công trước khi gán lớp.', v_teacher_count;
  END IF;

  -- Bước I.B: Chỉ khi v_teacher_count = 1 mới SELECT chi tiết UUID
  SELECT id, full_name, email
  INTO v_teacher_id, v_teacher_full_name, v_teacher_email
  FROM public.profiles
  WHERE role = 'teacher'
    AND LOWER(TRIM(regexp_replace(full_name, '\s+', ' ', 'g'))) = v_teacher_name_norm
  LIMIT 1;

  RAISE NOTICE 'XÁC NHẬN GIÁO VIÊN DUY NHẤT: ID=%, Name="%", Email=%', v_teacher_id, v_teacher_full_name, v_teacher_email;

  -- =========================================================================
  -- BƯỚC II: KIỂM TRA CHUẨN HÓA TÊN LỚP VÀ BẢO VỆ GIÁO VIÊN LỚP 2.12
  -- =========================================================================
  SELECT COUNT(*) INTO v_matching_classes_count
  FROM public.classes
  WHERE LOWER(TRIM(regexp_replace(name, '\s+', ' ', 'g'))) = v_class_name_norm
    AND grade_level = v_grade_level;

  IF v_matching_classes_count > 1 THEN
    RAISE EXCEPTION 'TRANSACTION ROLLBACK: Phát hiện % Lớp trùng tên (sau khi gộp khoảng trắng) "%" và grade_level = %. Cần kiểm tra gộp lớp thủ công!', v_matching_classes_count, v_class_name, v_grade_level;
  ELSIF v_matching_classes_count = 1 THEN
    v_class_is_new := FALSE;
    SELECT id, teacher_id INTO v_class_id, v_existing_teacher_id
    FROM public.classes
    WHERE LOWER(TRIM(regexp_replace(name, '\s+', ' ', 'g'))) = v_class_name_norm
      AND grade_level = v_grade_level
    LIMIT 1;

    -- Kiểm tra Giáo viên hiện tại của Lớp 2.12
    IF v_existing_teacher_id IS NULL THEN
      -- Nếu chưa có Giáo viên -> Được gán cho cô Lã Nguyễn Diễm Hương
      UPDATE public.classes
      SET teacher_id = v_teacher_id
      WHERE id = v_class_id;
      RAISE NOTICE 'LỚP 2.12 ĐÃ TỒN TẠI VÀ CHƯA CÓ GIÁO VIÊN -> ĐÃ GÁN CHO CÔ LÃ NGUYỄN DIỄM HƯƠNG (Class ID=%)', v_class_id;

    ELSIF v_existing_teacher_id = v_teacher_id THEN
      -- Nếu đã đúng ID cô Hương -> Giữ nguyên (không ghi đè mã lớp cũ)
      RAISE NOTICE 'LỚP 2.12 ĐÃ TỒN TẠI VÀ ĐÃ ĐÚNG CÔ LÃ NGUYỄN DIỄM HƯƠNG PHỤ TRÁCH (Class ID=%)', v_class_id;

    ELSE
      -- Nếu đang thuộc Giáo viên khác -> DỪNG TOÀN BỘ TRANSACTION VÀ ROLLBACK!
      SELECT full_name INTO v_existing_teacher_name 
      FROM public.profiles WHERE id = v_existing_teacher_id;

      RAISE EXCEPTION 'TRANSACTION ROLLBACK: Lớp 2.12 (ID: %) hiện đang do Giáo viên khác phụ trách (ID: %, Tên: "%"). Không thể tự ghi đè Giáo viên!', 
        v_class_id, v_existing_teacher_id, COALESCE(v_existing_teacher_name, 'Không rõ');
    END IF;

  ELSE
    -- Chưa có Lớp 2.12 -> Tạo mới với mã code kiểm tra độc nhất tuyệt đối
    v_class_is_new := TRUE;
    
    WHILE v_code_exists LOOP
      v_class_code := 'LOP212-' || UPPER(SUBSTRING(md5(random()::text) FROM 1 FOR 6));
      SELECT EXISTS (SELECT 1 FROM public.classes WHERE code = v_class_code) INTO v_code_exists;
    END LOOP;
    
    INSERT INTO public.classes (name, grade_level, code, teacher_id)
    VALUES (v_class_name, v_grade_level, v_class_code, v_teacher_id)
    RETURNING id INTO v_class_id;

    RAISE NOTICE 'TẠO MỚI LỚP 2.12 THÀNH CÔNG: Class ID=%, Code=%', v_class_id, v_class_code;
  END IF;

  -- =========================================================================
  -- BƯỚC III: ĐỐI CHIẾU KIỂM TRA TOÀN BỘ BẢN GHI CLASS_MEMBERS CHO 34 HỌC SINH
  -- (KHÔNG DÙNG MAX(uuid) TRÁNH LỖI ERROR 42883 ON POSTGRES)
  -- =========================================================================
  FOREACH v_name IN ARRAY v_student_names
  LOOP
    v_idx := v_idx + 1;
    v_norm_name := LOWER(TRIM(regexp_replace(v_name, '\s+', ' ', 'g')));

    -- Bước III.A: Đếm số lượng profile học sinh trùng tên chuẩn hóa
    SELECT COUNT(*)
    INTO v_matching_students_count
    FROM public.profiles
    WHERE role = 'student'
      AND LOWER(TRIM(regexp_replace(full_name, '\s+', ' ', 'g'))) = v_norm_name;

    IF v_matching_students_count = 0 THEN
      -- TRƯỜNG HỢP 1: Chưa có tài khoản profile -> Không tự tạo profile hay thêm lớp
      v_no_account := v_no_account + 1;
      INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_classes, note)
      VALUES (v_idx, v_name, 'CHƯA_CÓ_TÀI_KHOẢN', NULL, '-', 'Chưa tạo tài khoản và chưa thêm vào lớp (Cần tạo Auth/Profile trước)');

    ELSIF v_matching_students_count > 1 THEN
      -- TRƯỜNG HỢP 2: Có nhiều profile trùng tên -> Cần xác minh ID
      v_duplicate_name := v_duplicate_name + 1;
      INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_classes, note)
      VALUES (v_idx, v_name, 'TRÙNG_TÊN_NỀN_TẢNG', NULL, '-', 'Phát hiện ' || v_matching_students_count || ' tài khoản trùng tên, cần xác minh UUID');

    ELSE
      -- TRƯỜNG HỢP 3: Khớp duy nhất 1 profile -> SELECT UUID độc nhất
      SELECT id
      INTO v_matched_id
      FROM public.profiles
      WHERE role = 'student'
        AND LOWER(TRIM(regexp_replace(full_name, '\s+', ' ', 'g'))) = v_norm_name
      LIMIT 1;

      -- Kiểm tra TOÀN BỘ bản ghi class_members của v_matched_id
      SELECT 
        ARRAY_AGG(c.name),
        BOOL_OR(cm.class_id = v_class_id),
        COUNT(CASE WHEN cm.class_id <> v_class_id THEN 1 END)
      INTO v_all_member_classes, v_in_212, v_other_classes_count
      FROM public.class_members cm
      JOIN public.classes c ON c.id = cm.class_id
      WHERE cm.student_id = v_matched_id;

      v_classes_str := COALESCE(array_to_string(v_all_member_classes, ', '), 'Chưa có lớp');

      IF v_all_member_classes IS NULL OR array_length(v_all_member_classes, 1) IS NULL THEN
        -- Học sinh CHƯA THUỘC BẤT KỲ LỚP NÀO -> Đủ điều kiện duy nhất để thêm vào Lớp 2.12
        INSERT INTO public.class_members (class_id, student_id, joined_at)
        VALUES (v_class_id, v_matched_id, NOW())
        ON CONFLICT (class_id, student_id) DO NOTHING;

        v_added_count := v_added_count + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_classes, note)
        VALUES (v_idx, v_name, 'ĐỦ_ĐIỀU_KIỆN_ĐÃ_THÊM', v_matched_id, 'Chưa có lớp', 'Đã gán vào Lớp 2.12 thành công');

      ELSIF v_in_212 IS TRUE AND v_other_classes_count > 0 THEN
        -- Học sinh thuộc Lớp 2.12 VÀ ĐỒNG THỜI thuộc lớp khác -> Báo cần xác minh
        v_in_multiple_classes := v_in_multiple_classes + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_classes, note)
        VALUES (v_idx, v_name, 'THUỘC_NHIỀU_LỚP_CẦN_XÁC_MINH', v_matched_id, v_classes_str, 'Thuộc nhiều lớp gồm Lớp 2.12 và: ' || v_classes_str);

      ELSIF v_in_212 IS TRUE AND v_other_classes_count = 0 THEN
        -- Học sinh chỉ thuộc duy nhất Lớp 2.12 từ trước
        v_already_in_212_only := v_already_in_212_only + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_classes, note)
        VALUES (v_idx, v_name, 'ĐÃ_Ở_TRONG_LỚP_2.12', v_matched_id, v_classes_str, 'Giữ nguyên thành viên duy nhất của Lớp 2.12');

      ELSE
        -- Học sinh đang thuộc lớp khác (chưa thuộc Lớp 2.12) -> Không tự thêm hay chuyển lớp
        v_in_other_class := v_in_other_class + 1;
        INSERT INTO temp_import_report (stt, input_name, status, matched_student_id, current_classes, note)
        VALUES (v_idx, v_name, 'ĐANG_THUỘC_LỚP_KHÁC', v_matched_id, v_classes_str, 'Không tự đổi lớp. Đang thuộc: ' || v_classes_str);
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'BÁO CÁO PHẠM VI THỰC THI THAY ĐỔI DỮ LIỆU LỚP 2.12:';
  RAISE NOTICE ' - Giáo viên phụ trách: 1/1 (ID: %, Name: "%")', v_teacher_id, v_teacher_full_name;
  RAISE NOTICE ' - Lớp 2.12: % (ID: %)', CASE WHEN v_class_is_new THEN 'TẠO MỚI' ELSE 'TÁI SỬ DỤNG' END, v_class_id;
  RAISE NOTICE ' - Tổng danh sách học sinh yêu cầu đối chiếu: 34';
  RAISE NOTICE ' - Học sinh đủ điều kiện (có 1 profile & chưa có lớp) ĐÃ GÁN VÀO LỚP 2.12: %', v_added_count;
  RAISE NOTICE ' - Học sinh ở duy nhất Lớp 2.12 từ trước: %', v_already_in_212_only;
  RAISE NOTICE ' - Học sinh thuộc nhiều lớp (gồm Lớp 2.12) [CHƯA XỬ LÝ]: %', v_in_multiple_classes;
  RAISE NOTICE ' - Học sinh đang thuộc lớp khác [CHƯA TỰ ĐỔI LỚP]: %', v_in_other_class;
  RAISE NOTICE ' - Học sinh chưa có tài khoản [CHƯA TẠO PROFILE/LỚP]: %', v_no_account;
  RAISE NOTICE ' - Học sinh trùng tên [CHƯA XÁC MINH ID]: %', v_duplicate_name;
  RAISE NOTICE '=======================================================';
END $$;

-- HIỂN THỊ BẢNG KẾT QUẢ BÁO CÁO CHI TIẾT TRÊN SUPABASE SQL EDITOR
SELECT 
  stt AS "STT",
  input_name AS "Họ và Tên Học Sinh",
  status AS "Trạng Thái Báo Cáo Phân Loại",
  matched_student_id AS "UUID Hồ Sơ",
  current_classes AS "Danh Sách Lớp Hiện Tại",
  note AS "Ghi Chú Phạm Vi Xử Lý"
FROM temp_import_report
ORDER BY stt ASC;

COMMIT;
