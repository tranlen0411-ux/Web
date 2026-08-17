-- ============================================================================
-- SCRIPT PREFLIGHT CHỈ ĐỌC (READ-ONLY) CHUẨN HÓA & ĐỐI CHIẾU 34 HỌC SINH LỚP 2.12
-- KHÔNG DÙNG TEMP TABLE | KHÔNG THAY ĐỔI DỮ LIỆU | MỘT CÂU SELECT/CTE DUY NHẤT
-- ĐÃ KHẮC PHỤC TRIỆT ĐỂ LỖI ERROR 42883: MAX(UUID) BẰNG ARRAY_AGG FILTER
-- LỚP 2.12 HIỆN TẠI: GRADE 2 | CÔ LÃ NGUYỄN DIỄM HƯƠNG | MÃ LỚP: LOP212-3A5818
-- ============================================================================

WITH target_class_check AS (
  SELECT 
    COUNT(*)::INT AS target_class_count,
    (ARRAY_AGG(id) FILTER (WHERE id IS NOT NULL))[1] AS target_class_id,
    (ARRAY_AGG(code) FILTER (WHERE id IS NOT NULL))[1] AS target_class_code
  FROM public.classes
  WHERE LOWER(TRIM(regexp_replace(name, '\s+', ' ', 'g'))) = 'lớp 2.12'
    AND grade_level = 2
),
input_students(input_stt, input_name) AS (
  VALUES 
    (1,  'Trần Lê Hoàng An'),
    (2,  'Đỗ Hoài Anh'),
    (3,  'Nguyễn Đình Ân'),
    (4,  'Hà Gia Bảo'),
    (5,  'Phạm Ngọc Minh Châu'),
    (6,  'Nguyễn Công Minh Dương'),
    (7,  'Nguyễn Võ Khả Hân'),
    (8,  'Huỳnh Minh Hùng'),
    (9,  'Phạm Bùi Bảo Khang'),
    (10, 'Nguyễn Ngọc An Khánh'),
    (11, 'Nguyễn Phúc Đăng Khoa'),
    (12, 'Nguyễn Minh Khôi'),
    (13, 'Nguyễn Trung Kiên'),
    (14, 'Phạm Thị Hoàng Lâm'),
    (15, 'Võ Thiên Long'),
    (16, 'Trần Thị Quỳnh Mai'),
    (17, 'Lê Thị Tú My'),
    (18, 'Trần Ngọc Nga'),
    (19, 'Trần Thị Kim Ngọc'),
    (20, 'Võ Nguyễn Đăng Nguyên'),
    (21, 'Nguyễn Ngọc Yến Nhi'),
    (22, 'Nguyễn Thanh Nhi'),
    (23, 'Nguyễn An Nhiên'),
    (24, 'Võ Bảo Như'),
    (25, 'Lưu Đình Tấn Phát'),
    (26, 'Nguyễn Trần Mạnh Phi'),
    (27, 'Nguyễn Ngọc An Phúc'),
    (28, 'Nguyễn Thanh Phúc'),
    (29, 'Nguyễn Trí Phúc'),
    (30, 'Huỳnh Trương Tiến Thành'),
    (31, 'Hồ Lê Trường Thịnh'),
    (32, 'Phan Ngọc Bảo Trâm'),
    (33, 'Phạm Đỗ Anh Tú'),
    (34, 'Đặng Yến Vy')
),
normalized_inputs AS (
  SELECT 
    input_stt,
    input_name,
    LOWER(TRIM(regexp_replace(input_name, '\s+', ' ', 'g'))) AS norm_name
  FROM input_students
),
-- ĐỐI CHIẾU PROFILE HỌC SINH DÙNG ARRAY_AGG FILTER (TỪ BỎ MAX(UUID) TRÁNH ERROR 42883)
student_matches AS (
  SELECT 
    ni.input_stt,
    ni.input_name,
    ni.norm_name,
    COUNT(p.id)::INT AS matched_count,
    CASE 
      WHEN COUNT(p.id) = 1 THEN (ARRAY_AGG(p.id) FILTER (WHERE p.id IS NOT NULL))[1]
      ELSE NULL 
    END AS matched_student_id,
    CASE 
      WHEN COUNT(p.id) = 1 THEN (ARRAY_AGG(p.student_code) FILTER (WHERE p.id IS NOT NULL))[1]
      ELSE NULL 
    END AS matched_student_code
  FROM normalized_inputs ni
  LEFT JOIN public.profiles p ON p.role = 'student'
    AND LOWER(TRIM(regexp_replace(p.full_name, '\s+', ' ', 'g'))) = ni.norm_name
  GROUP BY ni.input_stt, ni.input_name, ni.norm_name
),
-- DÙNG ARRAY_AGG(c.name) FILTER (WHERE c.id IS NOT NULL) ĐỂ MẢNG KHÔNG CHỨA NULL
student_class_details AS (
  SELECT 
    sm.input_stt,
    sm.input_name,
    sm.matched_count,
    sm.matched_student_id,
    sm.matched_student_code,
    tc.target_class_count,
    tc.target_class_id,
    COALESCE(array_to_string(ARRAY_AGG(c.name ORDER BY cm.joined_at DESC) FILTER (WHERE c.id IS NOT NULL), ', '), '-') AS current_classes,
    COUNT(cm.class_id)::INT AS total_class_count,
    COUNT(CASE WHEN cm.class_id = tc.target_class_id THEN 1 END)::INT AS in_target_212_count,
    COUNT(CASE WHEN tc.target_class_id IS NOT NULL AND cm.class_id <> tc.target_class_id THEN 1 END)::INT AS in_other_class_count
  FROM student_matches sm
  CROSS JOIN target_class_check tc
  LEFT JOIN public.class_members cm ON cm.student_id = sm.matched_student_id
  LEFT JOIN public.classes c ON c.id = cm.class_id
  GROUP BY sm.input_stt, sm.input_name, sm.matched_count, sm.matched_student_id, sm.matched_student_code, tc.target_class_count, tc.target_class_id
),
classified_results AS (
  SELECT 
    scd.input_stt AS "STT",
    scd.input_name AS "Họ và Tên Đầu Vào",
    scd.matched_count AS "Số Profile Khớp",
    COALESCE(scd.matched_student_id::text, '-') AS "UUID Hồ Sơ",
    COALESCE(scd.matched_student_code, '-') AS "Mã Học Sinh",
    scd.current_classes AS "Các Lớp Hiện Tại",
    CASE 
      WHEN scd.target_class_count = 0 THEN 'LỖI_LỚP_2.12_KHÔNG_TỒN_TẠI'
      WHEN scd.target_class_count > 1 THEN 'LỖI_CÓ_NHIỀU_LỚP_2.12_TRÙNG_NỀN_TẢNG'
      WHEN scd.matched_count = 0 THEN 'CHƯA_CÓ_TÀI_KHOẢN'
      WHEN scd.matched_count > 1 THEN 'TRÙNG_TÊN'
      WHEN scd.total_class_count > 1 THEN 'THUỘC_NHIỀU_LỚP'
      WHEN scd.in_target_212_count = 1 AND scd.in_other_class_count = 0 THEN 'ĐÃ_Ở_LỚP_2.12'
      WHEN scd.in_other_class_count > 0 AND scd.in_target_212_count = 0 THEN 'ĐANG_Ở_LỚP_KHÁC'
      WHEN scd.total_class_count = 0 THEN 'KHỚP_DUY_NHẤT_CHƯA_CÓ_LỚP'
      ELSE 'KHÁC'
    END AS "Trạng Thái Báo Cáo"
  FROM student_class_details scd
)
SELECT * 
FROM classified_results
ORDER BY "STT" ASC;
