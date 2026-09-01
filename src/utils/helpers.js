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
  const trimmed = String(name).trim();
  const normalized = trimmed.replace(/^(?:lớp\s+)+/iu, '').trim();
  return normalized ? `Lớp ${normalized}` : 'Lớp';
};

/**
 * Suy ra số khối lớp (grade_level) từ object metadata của lớp học.
 * Ưu tiên: grade_level -> grade -> parse từ name/class_name ("Lớp 1A" -> 1, "Lớp 2.12" -> 2).
 * Trả về number từ 1-12 hoặc null.
 */
export const deriveGradeFromClass = (classObj) => {
  if (!classObj || typeof classObj !== 'object') return null;

  // 1. Ưu tiên thuộc tính grade_level có sẵn
  if (classObj.grade_level != null && !isNaN(Number(classObj.grade_level))) {
    const g = Number(classObj.grade_level);
    if (g >= 1 && g <= 12) return g;
  }

  // 2. Thuộc tính grade thay thế
  if (classObj.grade != null && !isNaN(Number(classObj.grade))) {
    const g = Number(classObj.grade);
    if (g >= 1 && g <= 12) return g;
  }

  // 3. Phân tích chuỗi từ tên lớp (name / class_name)
  const name = String(classObj.name || classObj.class_name || '').trim();
  if (!name) return null;

  // Khớp các mẫu: "Lớp 1A", "Lớp 2.12", "1A", "Khối 3", "Lớp 10A1", "12B"
  const match = name.match(/(?:lớp|khối)?\s*(\d{1,2})/i);
  if (match && match[1]) {
    const g = Number(match[1]);
    if (g >= 1 && g <= 12) return g;
  }

  return null;
};
