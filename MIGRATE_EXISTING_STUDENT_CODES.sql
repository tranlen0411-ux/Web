-- ============================================================================
-- DATA MIGRATION PREVIEW: GÁN STUDENT_CODE & PIN MẶC ĐỊNH CHO HỌC SINH MẪU
-- (Tách riêng khỏi Schema Migration - Chỉ thực thi khi Thầy/Cô cho phép)
-- ============================================================================

-- 1. Cập nhật student_code cho 5 học sinh mẫu hiện có
UPDATE public.profiles SET student_code = 'HS101' WHERE email = 'hs_nam@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS202' WHERE email = 'hs_an@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS303' WHERE email = 'hs_duc@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS404' WHERE email = 'hs_bao@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS505' WHERE email = 'hs_mai@hoclapvui.edu.vn';

-- 2. Đặt mã PIN '1234' ban đầu cho 5 học sinh mẫu bằng hàm public.set_student_pin
-- (Thực hiện bởi Admin trong SQL Editor)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role = 'student' AND student_code IS NOT NULL LOOP
    PERFORM public.set_student_pin(r.id, '1234');
  END LOOP;
END $$;
