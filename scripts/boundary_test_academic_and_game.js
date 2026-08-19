import { getAcademicTimeRangeBounds } from '../src/config/academicYearConfig.js';

const testTimestamps = [
  { name: '2026-08-31 23:59:59+07', iso: '2026-08-31T23:59:59+07:00' },
  { name: '2026-09-01 00:00:00+07', iso: '2026-09-01T00:00:00+07:00' },
  { name: '2027-01-09 23:59:59+07', iso: '2027-01-09T23:59:59+07:00' },
  { name: '2027-01-10 00:00:00+07', iso: '2027-01-10T00:00:00+07:00' },
  { name: '2027-05-30 23:59:59+07', iso: '2027-05-30T23:59:59+07:00' },
  { name: '2027-05-31 00:00:00+07', iso: '2027-05-31T00:00:00+07:00' }
];

const checkTimestampInBounds = (iso, bounds) => {
  if (!bounds.start || !bounds.end) return false;
  const time = new Date(iso).getTime();
  const start = new Date(bounds.start).getTime();
  const end = new Date(bounds.end).getTime();
  return time >= start && time < end;
};

const hk1Bounds = getAcademicTimeRangeBounds('HK1');
const hk2Bounds = getAcademicTimeRangeBounds('HK2');
const fullYearBounds = getAcademicTimeRangeBounds('FULL_YEAR');

console.log('========================================================================');
console.log('MA TRẬN KIỂM THỬ BOUNDARY THỜI GIAN KỸ THUẬT (TRÒ CHƠI & HỌC THUẬT)');
console.log('========================================================================');

const results = testTimestamps.map(t => {
  const isHK1 = checkTimestampInBounds(t.iso, hk1Bounds);
  const isHK2 = checkTimestampInBounds(t.iso, hk2Bounds);
  const isFullYear = checkTimestampInBounds(t.iso, fullYearBounds);

  let statusStr = [];
  if (isHK1) statusStr.push('HK1');
  if (isHK2) statusStr.push('HK2');
  if (isFullYear) statusStr.push('FULL_YEAR');
  if (statusStr.length === 0) statusStr.push('Outside (Ngoại phạm vi)');

  return {
    timestamp: t.name,
    is_hk1: isHK1,
    is_hk2: isHK2,
    is_full_year: isFullYear,
    summary: statusStr.join(' + ')
  };
});

console.table(results);
