-- ============================================================================
-- FILE SEED MIGRATION BỔ SUNG 10 TRÒ CHƠI HỌC TẬP LỚP 1 VÀ LỚP 2
-- ĐỊNH HƯỚNG THEO SÁCH KẾT NỐI TRI THỨC VỚI CUỘC SỐNG (100% NGUYÊN BẢN)
-- CHẠY AN TOÀN NGUYÊN TỬ (IDEMPOTENT BẰNG ON CONFLICT DO NOTHING)
-- KHÔNG BẬT LẠI GAME ADMIN ĐÃ ẨN, KHÔNG RESET PLAY_COUNT HOẶC GHI ĐÈ THUỘC TÍNH
-- ============================================================================

BEGIN;

-- 1. CHÈN 10 TRÒ CHƠI HỌC TẬP HỆ THỐNG VÀO PUBLIC.GAMES (DÙNG ON CONFLICT DO NOTHING)

INSERT INTO public.games (
  id, title, description, game_type, game_url, grade_level, subject, thumbnail_url, is_public, play_count
) VALUES
-- ============================================================================
-- LỚP 1 (5 TRÒ CHƠI)
-- ============================================================================
(
  '11111111-1111-4111-8111-000000000001',
  'Đoàn Tàu Số Học',
  'Quan sát số lượng đồ vật và chọn toa tàu mang số tương ứng (Các số từ 0 đến 10).',
  'builtin',
  'train-numbers',
  1,
  'Toán',
  '/images/games/train-numbers.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000002',
  'Ong Tìm Phép Tính',
  'Dẫn chú ong vàng tìm bông hoa có kết quả cộng trừ đúng trong phạm vi 10.',
  'builtin',
  'bee-math',
  1,
  'Toán',
  '/images/games/bee-math.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000003',
  'Cá Con So Sánh Số',
  'Giúp cá nhỏ chọn đúng dấu lớn hơn (>), bé hơn (<) hoặc bằng (=) giữa hai số.',
  'builtin',
  'fish-compare',
  1,
  'Toán',
  '/images/games/fish-compare.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000004',
  'Khu Vườn Âm Vần',
  'Ghép âm đầu và vần phù hợp để tạo thành từ Tiếng Việt đơn giản có nghĩa.',
  'builtin',
  'rhyme-garden',
  1,
  'Tiếng Việt',
  '/images/games/rhyme-garden.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000005',
  'Sóc Con Đọc Hiểu',
  'Đọc các câu và đoạn văn ngắn ngộ nghĩnh rồi chọn câu trả lời chính xác.',
  'builtin',
  'squirrel-reading',
  1,
  'Tiếng Việt',
  '/images/games/squirrel-reading.webp',
  true,
  0
),

-- ============================================================================
-- LỚP 2 (5 TRÒ CHƠI)
-- ============================================================================
(
  '11111111-1111-4111-8111-000000000006',
  'Đường Đua Trong Phạm Vi 100',
  'Mỗi phép tính cộng trừ phạm vi 100 đúng giúp xe đua của bé tăng tốc về đích.',
  'builtin',
  'speed-racing-100',
  2,
  'Toán',
  '/images/games/speed-racing-100.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000007',
  'Thám Hiểm Bảng Nhân',
  'Thử thách bảng nhân 2 và 5 để mở rương kho báu vàng kỳ diệu.',
  'builtin',
  'multiplication-treasure',
  2,
  'Toán',
  '/images/games/multiplication-treasure.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000008',
  'Đồng Hồ Thông Minh',
  'Quan sát mặt đồng hồ kim và chọn đúng mốc thời gian (giờ đúng, 15 phút, 30 phút).',
  'builtin',
  'smart-clock',
  2,
  'Toán',
  '/images/games/smart-clock.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000009',
  'Nhà Máy Câu Văn',
  'Sắp xếp các từ ngữ bị xáo trộn để tạo thành câu hoàn chỉnh chuẩn Tiếng Việt.',
  'builtin',
  'sentence-factory',
  2,
  'Tiếng Việt',
  '/images/games/sentence-factory.webp',
  true,
  0
),
(
  '11111111-1111-4111-8111-000000000010',
  'Rừng Xanh Kỳ Thú',
  'Nhận biết và phân loại các loài động vật, thực vật quen thuộc vào đúng nhóm.',
  'builtin',
  'jungle-discovery',
  2,
  'Tự nhiên & Xã hội',
  '/images/games/jungle-discovery.webp',
  true,
  0
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
