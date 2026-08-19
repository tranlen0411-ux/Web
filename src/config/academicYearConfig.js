// ============================================================================
// CẤU HÌNH KHUNG THỜI GIAN NĂM HỌC 2026 - 2027 (THEO KHUNG CHUẨN TP.HCM)
// Hỗ trợ cấu hình tập trung mốc Học kỳ 1, Học kỳ 2 và Cả năm học.
// ============================================================================

export const ACADEMIC_YEAR_CONFIG = {
  current_year_name: 'Năm học 2026 - 2027',
  timezones: 'Asia/Ho_Chi_Minh',
  
  // Mốc thời gian chính thức theo Quyết định Khung năm học TP.HCM
  semesters: {
    HK1: {
      label: 'Học kỳ 1 (2026 - 2027)',
      start: '2026-09-01T00:00:00+07:00',
      end: '2027-01-10T00:00:00+07:00'
    },
    HK2: {
      label: 'Học kỳ 2 (2026 - 2027)',
      start: '2027-01-10T00:00:00+07:00',
      end: '2027-05-31T00:00:00+07:00'
    },
    FULL_YEAR: {
      label: 'Cả năm học (2026 - 2027)',
      start: '2026-09-01T00:00:00+07:00',
      end: '2027-05-31T00:00:00+07:00'
    }
  }
};

/**
 * Trả về khoảng mốc ngày bắt đầu (start) và ngày kết thúc (end) dưới dạng ISO string
 * phục vụ cho việc lọc dữ liệu completed_at trong student_progress
 */
export const getAcademicTimeRangeBounds = (timeRangeKey) => {
  const now = new Date();
  
  if (timeRangeKey === 'WEEK') {
    const dayOfWeek = now.getDay() || 7;
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - (dayOfWeek - 1));
    return { start: startOfWeek.toISOString(), end: null };
  }
  
  if (timeRangeKey === 'MONTH') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: startOfMonth.toISOString(), end: null };
  }

  if (timeRangeKey === 'HK1') {
    return {
      start: ACADEMIC_YEAR_CONFIG.semesters.HK1.start,
      end: ACADEMIC_YEAR_CONFIG.semesters.HK1.end
    };
  }

  if (timeRangeKey === 'HK2') {
    return {
      start: ACADEMIC_YEAR_CONFIG.semesters.HK2.start,
      end: ACADEMIC_YEAR_CONFIG.semesters.HK2.end
    };
  }

  if (timeRangeKey === 'FULL_YEAR') {
    return {
      start: ACADEMIC_YEAR_CONFIG.semesters.FULL_YEAR.start,
      end: ACADEMIC_YEAR_CONFIG.semesters.FULL_YEAR.end
    };
  }

  return { start: null, end: null };
};
