// Các hàm tiện ích bổ trợ cho ứng dụng học tập tiểu học

export const formatSecondsToTime = (seconds = 0) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins > 0 ? `${mins} phút ` : ''}${secs} giây`;
};

export const getAvatarBySeed = (seed = 'student') => {
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed)}`;
};

export const GRADE_LABELS = {
  1: 'Lớp 1 (6 tuổi)',
  2: 'Lớp 2 (7 tuổi)',
  3: 'Lớp 3 (8 tuổi)',
  4: 'Lớp 4 (9 tuổi)',
  5: 'Lớp 5 (10 tuổi)',
};

export const SUBJECT_ICONS = {
  'Toán': 'Calculator',
  'Tiếng Việt': 'BookOpen',
  'Tiếng Anh': 'Languages',
  'Tự nhiên & Xã hội': 'Trees',
  'Lịch sử & Địa lý': 'Globe',
  'Tin học': 'Laptop',
};

export const formatClassLabel = (name) => {
  if (!name) return '';
  const trimmed = name.trim();
  if (/^Lớp\b/i.test(trimmed)) {
    return trimmed;
  }
  return `Lớp ${trimmed}`;
};
