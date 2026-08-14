-- ============================================================================
-- DATA MIGRATION PREVIEW: GÁN STUDENT_CODE CHO 5 HỌC SINH MẪU
-- (Tách riêng khỏi Schema Migration - CHỈ THỰC THI KHI THẦY/CÔ CHO PHÉP)
-- ============================================================================

-- Gán mã học sinh chính thức vào cột student_code cho 5 học sinh mẫu hiện có
UPDATE public.profiles SET student_code = 'HS101' WHERE email = 'hs_nam@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS202' WHERE email = 'hs_an@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS303' WHERE email = 'hs_duc@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS404' WHERE email = 'hs_bao@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS505' WHERE email = 'hs_mai@hoclapvui.edu.vn';
