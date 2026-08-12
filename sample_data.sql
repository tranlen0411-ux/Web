-- ============================================================================
-- KHO TRÒ CHƠI HỌC VUI TIỂU HỌC (KHỐI 1 - 5)
-- DỮ LIỆU MẪU THỬ NGHIỆM HỆ THỐNG (SAMPLE TEST DATA FOR SUPABASE)
-- ============================================================================

-- 1. NẠP TÀI KHOẢN MẪU VÀO AUTH.USERS & PROFILES
-- Mật khẩu mặc định của tất cả tài khoản thử nghiệm là: 123456 (Admin là: admin123456)

INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at, 
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
) VALUES
-- Admin System
(
  'a0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'admin@hoclapvui.edu.vn',
  crypt('admin123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Quản Trị Viên Hệ Thống","role":"admin","grade_level":1}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Giáo Viên 1 (Cô Nguyễn Thị Hoa)
(
  't0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'co.hoa@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Cô Nguyễn Thị Hoa","role":"teacher","grade_level":1}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Giáo Viên 2 (Thầy Trần Đức Minh)
(
  't0000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'thay.minh@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Thầy Trần Đức Minh","role":"teacher","grade_level":3}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Học Sinh 1 (Nguyễn Văn Nam - Khối 1)
(
  's0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'hs_nam@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Nguyễn Văn Nam (HS101)","role":"student","grade_level":1}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Học Sinh 2 (Lê Thúy An - Khối 2)
(
  's0000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'hs_an@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Lê Thúy An (HS202)","role":"student","grade_level":2}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Học Sinh 3 (Trần Minh Đức - Khối 3)
(
  's0000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'hs_duc@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Trần Minh Đức (HS303)","role":"student","grade_level":3}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Học Sinh 4 (Phạm Gia Bảo - Khối 4)
(
  's0000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000004',
  'hs_bao@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Phạm Gia Bảo (HS404)","role":"student","grade_level":4}',
  now(), now(), 'authenticated', 'authenticated'
),
-- Học Sinh 5 (Hoàng Thị Mai - Khối 5)
(
  's0000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000005',
  'hs_mai@hoclapvui.edu.vn',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Hoàng Thị Mai (HS505)","role":"student","grade_level":5}',
  now(), now(), 'authenticated', 'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- 2. CẬP NHẬT ĐIỂM SAO VÀ XU CHO CÁC HỌC SINH MẪU
UPDATE public.profiles SET total_stars = 150, total_coins = 60, avatar_url = 'https://api.dicebear.com/7.x/bottts/svg?seed=Nam' WHERE id = 's0000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET total_stars = 120, total_coins = 45, avatar_url = 'https://api.dicebear.com/7.x/bottts/svg?seed=An' WHERE id = 's0000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET total_stars = 210, total_coins = 90, avatar_url = 'https://api.dicebear.com/7.x/bottts/svg?seed=Duc' WHERE id = 's0000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET total_stars = 280, total_coins = 120, avatar_url = 'https://api.dicebear.com/7.x/bottts/svg?seed=Bao' WHERE id = 's0000000-0000-0000-0000-000000000004';
UPDATE public.profiles SET total_stars = 350, total_coins = 150, avatar_url = 'https://api.dicebear.com/7.x/bottts/svg?seed=Mai' WHERE id = 's0000000-0000-0000-0000-000000000005';

-- 3. NẠP DỮ LIỆU LỚP HỌC MẪU (CLASSES)
INSERT INTO public.classes (id, name, grade_level, code, teacher_id) VALUES
('c0000000-0000-0000-0000-000000000001', 'Lớp 1A - Họa Mi', 1, 'LOP1A', 't0000000-0000-0000-0000-000000000001'),
('c0000000-0000-0000-0000-000000000002', 'Lớp 2B - Vàng Anh', 2, 'LOP2B', 't0000000-0000-0000-0000-000000000001'),
('c0000000-0000-0000-0000-000000000003', 'Lớp 3A - Sơn Ca', 3, 'LOP3A', 't0000000-0000-0000-0000-000000000002'),
('c0000000-0000-0000-0000-000000000004', 'Lớp 4C - Đại Bàng', 4, 'LOP4C', 't0000000-0000-0000-0000-000000000002'),
('c0000000-0000-0000-0000-000000000005', 'Lớp 5A - Phượng Hoàng', 5, 'LOP5A', 't0000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- 4. PHÂN HỌC SINH VÀO CÁC LỚP (CLASS_MEMBERS)
INSERT INTO public.class_members (class_id, student_id) VALUES
('c0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000001'),
('c0000000-0000-0000-0000-000000000002', 's0000000-0000-0000-0000-000000000002'),
('c0000000-0000-0000-0000-000000000003', 's0000000-0000-0000-0000-000000000003'),
('c0000000-0000-0000-0000-000000000004', 's0000000-0000-0000-0000-000000000004'),
('c0000000-0000-0000-0000-000000000005', 's0000000-0000-0000-0000-000000000005')
ON CONFLICT DO NOTHING;

-- 5. PHÁT TRIỂN THÊM KHO GAME HỌC TẬP (GAMES)
INSERT INTO public.games (id, title, description, thumbnail_url, game_type, game_url, grade_level, subject, is_public, play_count) VALUES
(
  '55555555-5555-5555-5555-555555555555',
  'Thử Thách Đếm Số & Phép Cộng Phạm Vi 10',
  'Trò chơi toán học trực quan với hình ảnh các quả táo và con vật giúp bé Lớp 1 làm quen với phép cộng.',
  'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?w=500&auto=format&fit=crop&q=60',
  'builtin',
  'memory-game',
  1,
  'Toán',
  true,
  310
),
(
  '66666666-6666-6666-6666-666666666666',
  'Bảng Cửu Chương Kỳ Diệu Lớp 2 & 3',
  'Luyện tập bảng nhân 2 đến bảng nhân 9 với các thử thách đua xe câu hỏi trắc nghiệm tốc độ.',
  'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=500&auto=format&fit=crop&q=60',
  'builtin',
  'quiz-race',
  3,
  'Toán',
  true,
  450
),
(
  '77777777-7777-7777-7777-777777777777',
  'Hành Trình Khám Phá Lịch Sử Việt Nam',
  'Trắc nghiệm tương tác các cột mốc lịch sử và danh nhân văn hóa Việt Nam dành cho học sinh Khối 4 & 5.',
  'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=500&auto=format&fit=crop&q=60',
  'iframe',
  'https://wordwall.net/embed/4f6d4d1e2e924a66a1a4c9c22822a101',
  5,
  'Lịch sử & Địa lý',
  true,
  180
),
(
  '88888888-8888-8888-8888-888888888888',
  'Luyện Kỹ Năng Sử Dụng Máy Tính & Tin Học',
  'Nhận biết các bộ phận máy tính, bàn phím và quy tắc an toàn khi sử dụng Internet cho bé.',
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=500&auto=format&fit=crop&q=60',
  'iframe',
  'https://quizizz.com/embed/quiz/609a1f2b3e45f9001b9d4e5f',
  3,
  'Tin học',
  true,
  220
)
ON CONFLICT (id) DO NOTHING;

-- 6. GIAO BÀI TẬP MẪU CHO CÁC LỚP (ASSIGNMENTS)
INSERT INTO public.assignments (id, game_id, class_id, reward_stars, due_date) VALUES
('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 20, now() + interval '7 days'),
('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002', 25, now() + interval '5 days'),
('a3333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-000000000003', 30, now() + interval '10 days')
ON CONFLICT (id) DO NOTHING;

-- 7. NHẬT KÝ TIẾN ĐỘ HOÀN THÀNH GAME CỦA HỌC SINH (STUDENT_PROGRESS)
INSERT INTO public.student_progress (assignment_id, game_id, student_id, status, score, stars_earned, completion_time_seconds) VALUES
('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 's0000000-0000-0000-0000-000000000001', 'completed', 100, 20, 45),
('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 's0000000-0000-0000-0000-000000000002', 'completed', 90, 25, 60),
('a3333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', 's0000000-0000-0000-0000-000000000003', 'completed', 100, 30, 50);

-- 8. GHI NHẬN HUY HIỆU ĐÃ MỞ KHÓA CHO HỌC SINH TOP (STUDENT_BADGES)
INSERT INTO public.student_badges (student_id, badge_id)
SELECT 's0000000-0000-0000-0000-000000000005', id FROM public.badges WHERE title = 'Thần Đồng Toán Học'
ON CONFLICT DO NOTHING;

INSERT INTO public.student_badges (student_id, badge_id)
SELECT 's0000000-0000-0000-0000-000000000004', id FROM public.badges WHERE title = 'Ong Chăm Chỉ'
ON CONFLICT DO NOTHING;

INSERT INTO public.student_badges (student_id, badge_id)
SELECT 's0000000-0000-0000-0000-000000000003', id FROM public.badges WHERE title = 'Bậc Thầy Lật Thẻ'
ON CONFLICT DO NOTHING;

