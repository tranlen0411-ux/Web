import assert from 'node:assert/strict';
import { getAcademicTimeRangeBounds } from '../src/config/academicYearConfig.js';

// Danh sách 6 timestamp kiểm thử ranh giới bắt buộc
const testCases = [
  {
    name: '2026-08-31 23:59:59+07',
    iso: '2026-08-31T23:59:59+07:00',
    expected: { is_hk1: false, is_hk2: false, is_full_year: false }
  },
  {
    name: '2026-09-01 00:00:00+07',
    iso: '2026-09-01T00:00:00+07:00',
    expected: { is_hk1: true, is_hk2: false, is_full_year: true }
  },
  {
    name: '2027-01-09 23:59:59+07',
    iso: '2027-01-09T23:59:59+07:00',
    expected: { is_hk1: true, is_hk2: false, is_full_year: true }
  },
  {
    name: '2027-01-10 00:00:00+07',
    iso: '2027-01-10T00:00:00+07:00',
    expected: { is_hk1: false, is_hk2: true, is_full_year: true }
  },
  {
    name: '2027-05-30 23:59:59+07',
    iso: '2027-05-30T23:59:59+07:00',
    expected: { is_hk1: false, is_hk2: true, is_full_year: true }
  },
  {
    name: '2027-05-31 00:00:00+07',
    iso: '2027-05-31T00:00:00+07:00',
    expected: { is_hk1: false, is_hk2: false, is_full_year: false }
  }
];

// Hàm kiểm tra ranh giới thời gian (dùng cho cả Trò chơi completed_at và Học thuật assigned_at)
// Áp dụng đúng nguyên tắc kỹ thuật: start <= time < end
const checkInBounds = (iso, bounds) => {
  if (!bounds.start || !bounds.end) return false;
  const t = new Date(iso).getTime();
  const s = new Date(bounds.start).getTime();
  const e = new Date(bounds.end).getTime();
  return t >= s && t < e;
};

const hk1Bounds = getAcademicTimeRangeBounds('HK1');
const hk2Bounds = getAcademicTimeRangeBounds('HK2');
const fullYearBounds = getAcademicTimeRangeBounds('FULL_YEAR');

console.log('========================================================================');
console.log('KIỂM THỬ TỰ ĐỘNG THẬT VỚI ASSERTION (TRÒ CHƠI COMPLETED_AT & HỌC THUẬT ASSIGNED_AT)');
console.log('========================================================================\n');

let failedCount = 0;
const resultsForDisplay = [];

for (const tc of testCases) {
  const actual_hk1 = checkInBounds(tc.iso, hk1Bounds);
  const actual_hk2 = checkInBounds(tc.iso, hk2Bounds);
  const actual_full_year = checkInBounds(tc.iso, fullYearBounds);

  const actual = {
    is_hk1: actual_hk1,
    is_hk2: actual_hk2,
    is_full_year: actual_full_year
  };

  try {
    assert.deepStrictEqual(
      actual,
      tc.expected,
      `❌ LỖI RANH GIỚI TẠI TIMESTAMP ${tc.name}:
      Expected: HK1=${tc.expected.is_hk1}, HK2=${tc.expected.is_hk2}, FULL_YEAR=${tc.expected.is_full_year}
      Actual:   HK1=${actual.is_hk1}, HK2=${actual.is_hk2}, FULL_YEAR=${actual.is_full_year}`
    );

    resultsForDisplay.push({
      Timestamp: tc.name,
      HK1: actual_hk1 ? '✅ TRUE' : '❌ FALSE',
      HK2: actual_hk2 ? '✅ TRUE' : '❌ FALSE',
      FULL_YEAR: actual_full_year ? '✅ TRUE' : '❌ FALSE',
      Status: 'PASSED'
    });
  } catch (err) {
    failedCount++;
    console.error(err.message);
    resultsForDisplay.push({
      Timestamp: tc.name,
      HK1: actual_hk1 ? 'TRUE' : 'FALSE',
      HK2: actual_hk2 ? 'TRUE' : 'FALSE',
      FULL_YEAR: actual_full_year ? 'TRUE' : 'FALSE',
      Status: 'FAILED ❌'
    });
  }
}

console.table(resultsForDisplay);

if (failedCount > 0) {
  console.error(`\n❌ CÓ ${failedCount} TRƯỜNG HỢP KIỂM THỬ THẤT BẠI! EXIT CODE 1.`);
  process.exit(1);
} else {
  console.log('\n✅ TOÀN BỘ 6/6 TRƯỜNG HỢP KIỂM THỬ RANH GIỚI THỜI GIAN ĐẠT CHUẨN 100%! EXIT CODE 0.');
  process.exit(0);
}
