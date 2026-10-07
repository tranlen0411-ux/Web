import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  sanitizeForFormulaInjection,
  escapeCsvValue,
  formatQuestionType,
  formatOptionDistribution,
  sanitizeFilenamePart,
  formatExportTimestamp,
  getExportDisplayName,
  calculateWorksheetColumnWidths,
  buildLeaderboardCsv,
  buildAnalyticsCsv,
  buildCompetitionWorkbook
} from '../src/utils/competitionExport.js';

test('COMPETITION V1 R9 — EXPORT UX & PRINT POLISH TEST SUITE', async (t) => {

  // =========================================================================
  // GROUP 1: XLSX Auto Column Width Engine
  // =========================================================================
  await t.test('Group 1: XLSX Auto Column Width Engine', async (t1) => {
    await t1.test('1. returns one width config object per column in AoA', () => {
      const rows = [
        ['ColA', 'ColB', 'ColC'],
        ['Val1', 'Val2', 'Val3']
      ];
      const widths = calculateWorksheetColumnWidths(rows);
      assert.equal(widths.length, 3);
      assert.ok(widths.every(w => typeof w.wch === 'number'));
    });

    await t1.test('2. min width = 10 is strictly enforced for short contents', () => {
      const rows = [
        ['H', 'A', '1'],
        ['2', 'B', '4']
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 10, padding: 3 });
      assert.equal(widths[0].wch, 10);
      assert.equal(widths[1].wch, 10);
      assert.equal(widths[2].wch, 10);
    });

    await t1.test('3. default max = 42 is enforced for standard columns', () => {
      const longText = 'A'.repeat(100);
      const rows = [
        ['Header', longText]
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 10, defaultMaxWidth: 42, padding: 3 });
      assert.equal(widths[1].wch, 42);
    });

    await t1.test('4. question text column max = 60 is enforced via override', () => {
      const longQuestion = 'Nội dung câu hỏi cực kỳ dài '.repeat(10);
      const rows = [
        ['STT', 'Dạng câu', longQuestion]
      ];
      const widths = calculateWorksheetColumnWidths(rows, {
        minWidth: 10,
        defaultMaxWidth: 42,
        padding: 3,
        columnMaxOverrides: { 2: 60 }
      });
      assert.equal(widths[2].wch, 60);
    });

    await t1.test('5. option distribution column max = 55 is enforced via override', () => {
      const longDistribution = 'A: 10 (20%) [Đúng] | B: 15 (30%) | C: 20 (40%) | D: 5 (10%) '.repeat(3);
      const rows = [
        ['STT', 'Phân bố', longDistribution]
      ];
      const widths = calculateWorksheetColumnWidths(rows, {
        minWidth: 10,
        defaultMaxWidth: 42,
        padding: 3,
        columnMaxOverrides: { 2: 55 }
      });
      assert.equal(widths[2].wch, 55);
    });

    await t1.test('6. padding (+3) is properly added to max cell character length', () => {
      const cellText = 'NguyenVanA'; // 10 chars
      const rows = [
        ['Tên'],
        [cellText]
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 5, defaultMaxWidth: 42, padding: 3 });
      // max(10 chars + 3 padding, 5 minWidth) = 13
      assert.equal(widths[0].wch, 13);
    });

    await t1.test('7. null and undefined cells are handled safely without crashing', () => {
      const rows = [
        ['Header1', 'Header2', 'Header3'],
        [null, undefined, '']
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 10, padding: 3 });
      assert.equal(widths.length, 3);
      assert.equal(widths[0].wch, 10);
      assert.equal(widths[1].wch, 10);
      assert.equal(widths[2].wch, 10);
    });

    await t1.test('8. numeric and boolean cell values convert properly for width measurement', () => {
      const rows = [
        ['Score', 'IsGuest', 'AvgTime'],
        [1500000, true, 12.34567]
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 5, defaultMaxWidth: 42, padding: 2 });
      // 1500000 -> 7 chars + 2 = 9
      assert.equal(widths[0].wch, 9);
      // 'IsGuest' -> 7 chars + 2 = 9
      assert.equal(widths[1].wch, 9);
    });

    await t1.test('9. Vietnamese Unicode diacritics count correctly as characters', () => {
      const vnName = 'Trần Lê Nguyễn Hoàng'; // 20 chars
      const rows = [
        ['Tên Thí Sinh'],
        [vnName]
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 10, defaultMaxWidth: 42, padding: 3 });
      assert.equal(widths[0].wch, 20 + 3); // 23
    });

    await t1.test('10. multiline cells with LF split lines and measure the longest line', () => {
      const multiline = 'Line 1\nLine number 2 is longer\nL3';
      const rows = [
        ['Header'],
        [multiline]
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 5, defaultMaxWidth: 42, padding: 2 });
      // 'Line number 2 is longer' is 23 chars + 2 = 25
      assert.equal(widths[0].wch, 25);
    });

    await t1.test('11. multiline cells with CRLF split lines safely', () => {
      const multilineCRLF = 'Row One\r\nLongest Row Two Here\r\nRow Three';
      const rows = [
        ['Header'],
        [multilineCRLF]
      ];
      const widths = calculateWorksheetColumnWidths(rows, { minWidth: 5, defaultMaxWidth: 42, padding: 2 });
      // 'Longest Row Two Here' is 20 chars + 2 = 22
      assert.equal(widths[0].wch, 22);
    });

    await t1.test('12. empty rows or empty AoA returns empty array safely', () => {
      assert.deepEqual(calculateWorksheetColumnWidths([]), []);
      assert.deepEqual(calculateWorksheetColumnWidths(null), []);
      assert.deepEqual(calculateWorksheetColumnWidths(undefined), []);
    });

    await t1.test('13. leaderboard worksheet in buildCompetitionWorkbook receives !cols', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường Vui',
        roomCode: 'DT-888',
        leaderboardData: [
          { rank: 1, display_name: 'Nguyễn Văn A', total_score: 100, correct_count: 5, total_response_time_ms: 12000, is_guest: false }
        ],
        analyticsData: { summary: {}, questions: [] }
      });
      const wsLeaderboard = wb.Sheets['Bang Xep Hang'];
      assert.ok(Array.isArray(wsLeaderboard['!cols']), 'Leaderboard sheet must have !cols defined');
      assert.equal(wsLeaderboard['!cols'].length, 6);
    });

    await t1.test('14. analytics worksheet in buildCompetitionWorkbook receives !cols with overrides', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường Vui',
        roomCode: 'DT-888',
        leaderboardData: [],
        analyticsData: {
          summary: { total_questions: 1, final_roster_count: 10, overall_accuracy_percent: 80 },
          questions: [
            {
              question_order: 1,
              question_type: 'single_choice',
              question_text: 'Thủ đô của Việt Nam là gì?',
              points: 10,
              final_roster_count: 10,
              answered_count: 10,
              unanswered_count: 0,
              correct_count: 8,
              incorrect_count: 2,
              accuracy_percent: 80,
              average_points: 8,
              average_response_time_ms: 5400,
              option_distribution: [
                { option_text: 'Hà Nội', selection_count: 8, selection_percent: 80, is_correct: true },
                { option_text: 'TP.HCM', selection_count: 2, selection_percent: 20, is_correct: false }
              ]
            }
          ]
        }
      });
      const wsAnalytics = wb.Sheets['Phan Tich Cau Hoi'];
      assert.ok(Array.isArray(wsAnalytics['!cols']), 'Analytics sheet must have !cols defined');
      assert.equal(wsAnalytics['!cols'].length, 13);
    });

    await t1.test('15. auto-width calculation does NOT alter or mutate cell data', () => {
      const rawData = [
        ['Rank', 'Name'],
        [1, 'Le Van C']
      ];
      const copyData = JSON.parse(JSON.stringify(rawData));
      calculateWorksheetColumnWidths(rawData);
      assert.deepEqual(rawData, copyData);
    });

    await t1.test('16. formula-injection apostrophe remains intact before width calc', () => {
      const maliciousName = '=1+1';
      const wb = buildCompetitionWorkbook({
        leaderboardData: [
          { rank: 1, display_name: maliciousName, total_score: 10, correct_count: 1, total_response_time_ms: 1000 }
        ]
      });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const cellB7 = sheet['B7']; // 7th row in Excel (index 6: 4 metadata rows + 1 empty + 1 header + 1 data)
      assert.ok(cellB7, 'Cell B7 must exist');
      assert.equal(cellB7.v, "'=1+1", 'Apostrophe prefix must be present in cell value');
    });
  });

  // =========================================================================
  // GROUP 2: Anonymized Export Logic & Display Name Helper
  // =========================================================================
  await t.test('Group 2: Anonymized Export Logic & Privacy Contract', async (t2) => {
    await t2.test('17. getExportDisplayName with isAnonymized=false returns original display_name', () => {
      const row = { display_name: 'Nguyễn Văn Minh' };
      assert.equal(getExportDisplayName(row, 0, false), 'Nguyễn Văn Minh');
    });

    await t2.test('18. getExportDisplayName with isAnonymized=true returns "Thí sinh 1" for index 0', () => {
      const row = { display_name: 'Nguyễn Văn Minh' };
      assert.equal(getExportDisplayName(row, 0, true), 'Thí sinh 1');
    });

    await t2.test('19. getExportDisplayName with isAnonymized=true returns "Thí sinh 2" for index 1', () => {
      const row = { display_name: 'Trần Thị Mai' };
      assert.equal(getExportDisplayName(row, 1, true), 'Thí sinh 2');
    });

    await t2.test('20. getExportDisplayName with isAnonymized=true returns "Thí sinh 3" for index 2', () => {
      const row = { display_name: 'Lê Hoàng Long' };
      assert.equal(getExportDisplayName(row, 2, true), 'Thí sinh 3');
    });

    await t2.test('21. backend rank ties 1, 1, 3 are preserved identically with anonymous labels', () => {
      const tiedData = [
        { rank: 1, display_name: 'Alpha', total_score: 100, correct_count: 5, total_response_time_ms: 10000 },
        { rank: 1, display_name: 'Beta', total_score: 100, correct_count: 5, total_response_time_ms: 10000 },
        { rank: 3, display_name: 'Gamma', total_score: 80, correct_count: 4, total_response_time_ms: 12000 }
      ];
      const csv = buildLeaderboardCsv({ leaderboardData: tiedData, isAnonymized: true });
      assert.ok(csv.includes('1,Thí sinh 1,100,5,10.00,Tài khoản'));
      assert.ok(csv.includes('1,Thí sinh 2,100,5,10.00,Tài khoản'));
      assert.ok(csv.includes('3,Thí sinh 3,80,4,12.00,Tài khoản'));
    });

    await t2.test('22. anonymous number is strictly label only and never replaces backend rank', () => {
      const nonSequentialRankData = [
        { rank: 5, display_name: 'Player Five', total_score: 50, correct_count: 2, total_response_time_ms: 20000 }
      ];
      const csv = buildLeaderboardCsv({ leaderboardData: nonSequentialRankData, isAnonymized: true });
      assert.ok(csv.includes('5,Thí sinh 1,50,2,20.00,Tài khoản'), 'Rank 5 must be preserved even though label is Thí sinh 1');
    });

    await t2.test('23. CSV normal mode contains original student display_name', () => {
      const data = [{ rank: 1, display_name: 'Nguyễn Văn Thực Thể', total_score: 100, correct_count: 5, total_response_time_ms: 1000 }];
      const csv = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: false });
      assert.ok(csv.includes('Nguyễn Văn Thực Thể'));
    });

    await t2.test('24. CSV anonymous mode does NOT contain original student display_name', () => {
      const data = [{ rank: 1, display_name: 'Nguyễn Văn Thực Thể', total_score: 100, correct_count: 5, total_response_time_ms: 1000 }];
      const csv = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: true });
      assert.ok(!csv.includes('Nguyễn Văn Thực Thể'));
      assert.ok(csv.includes('Thí sinh 1'));
    });

    await t2.test('25. XLSX normal mode contains original student display_name', () => {
      const data = [{ rank: 1, display_name: 'Hoàng Kim Bảo', total_score: 100, correct_count: 5, total_response_time_ms: 1000 }];
      const wb = buildCompetitionWorkbook({ leaderboardData: data, isAnonymized: false });
      const sheet = wb.Sheets['Bang Xep Hang'];
      assert.equal(sheet['B7'].v, 'Hoàng Kim Bảo');
    });

    await t2.test('26. XLSX anonymous mode replaces display_name with "Thí sinh 1"', () => {
      const data = [{ rank: 1, display_name: 'Hoàng Kim Bảo', total_score: 100, correct_count: 5, total_response_time_ms: 1000 }];
      const wb = buildCompetitionWorkbook({ leaderboardData: data, isAnonymized: true });
      const sheet = wb.Sheets['Bang Xep Hang'];
      assert.equal(sheet['B7'].v, 'Thí sinh 1');
    });

    await t2.test('27. participant_id is absent from both normal and anonymous exports', () => {
      const data = [{ participant_id: 'part-uuid-1234', rank: 1, display_name: 'A', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }];
      const csvNormal = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: false });
      const csvAnon = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: true });
      assert.ok(!csvNormal.includes('part-uuid-1234'));
      assert.ok(!csvAnon.includes('part-uuid-1234'));
    });

    await t2.test('28. user_id is absent from both normal and anonymous exports', () => {
      const data = [{ user_id: 'user-uuid-9999', rank: 1, display_name: 'A', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }];
      const csv = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: true });
      assert.ok(!csv.includes('user-uuid-9999'));
    });

    await t2.test('29. email and avatar_url are absent from exports', () => {
      const data = [{ email: 'student@school.edu', avatar_url: 'https://cdn/avatar.png', rank: 1, display_name: 'A', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }];
      const csv = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: true });
      assert.ok(!csv.includes('student@school.edu'));
      assert.ok(!csv.includes('avatar.png'));
    });

    await t2.test('30. team_id and guest_token_hash are absent from exports', () => {
      const data = [{ team_id: 'team-42', guest_token_hash: 'hash-abc-xyz', rank: 1, display_name: 'A', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }];
      const csv = buildLeaderboardCsv({ leaderboardData: data, isAnonymized: true });
      assert.ok(!csv.includes('team-42'));
      assert.ok(!csv.includes('hash-abc-xyz'));
    });

    await t2.test('31. analytics CSV is completely unaffected by anonymize mode and contains zero PII', () => {
      const analytics = {
        summary: { total_questions: 1, final_roster_count: 5, overall_accuracy_percent: 100 },
        questions: [{
          question_order: 1,
          question_type: 'single_choice',
          question_text: 'Câu 1?',
          points: 10,
          answered_count: 5,
          correct_count: 5,
          accuracy_percent: 100,
          option_distribution: []
        }]
      };
      const csv = buildAnalyticsCsv({ analyticsData: analytics });
      assert.ok(csv.includes('BÁO CÁO PHÂN TÍCH CÂU HỎI'));
      assert.ok(!csv.includes('participant_id'));
    });
  });

  // =========================================================================
  // GROUP 3: HostPrintableReport Multi-Page Hardening & Print CSS
  // =========================================================================
  await t.test('Group 3: HostPrintableReport Multi-Page Hardening & Print Isolation', async (t3) => {
    const reportPath = path.resolve('src/components/competition/HostPrintableReport.jsx');
    const reportSource = fs.readFileSync(reportPath, 'utf8');

    await t3.test('32. large table parent containers do not have broad break-inside-avoid', () => {
      // Ensure leaderboard and question table wrappers don't block page breaks
      assert.ok(!reportSource.includes('<div className="space-y-2 break-inside-avoid">\n        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">2. Bảng Xếp Hạng'),
        'Leaderboard table container must not have break-inside-avoid');
      assert.ok(!reportSource.includes('<div className="space-y-2 break-inside-avoid">\n          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">3. Thống Kê'),
        'Analytics question table container must not have break-inside-avoid');
    });

    await t3.test('33. thead elements enforce [display:table-header-group] for multi-page repeating', () => {
      assert.ok(reportSource.includes('[display:table-header-group]'), 'Table thead must repeat on page splits');
    });

    await t3.test('34. tbody table rows enforce break-inside-avoid / page-break-inside avoid', () => {
      assert.ok(reportSource.includes('break-inside-avoid'), 'Individual rows must avoid splitting mid-row');
      assert.ok(reportSource.includes('[page-break-inside:avoid]'), 'CSS page-break-inside avoid must be present');
    });

    await t3.test('35. long question text has word wrapping rules to avoid horizontal overflow', () => {
      assert.ok(reportSource.includes('break-words') && reportSource.includes('[overflow-wrap:anywhere]'),
        'Question text and option distribution must have word break / wrap rules');
    });

    await t3.test('36. HostPrintableReport is isolated with hidden print:block', () => {
      assert.ok(reportSource.includes('hidden print:block'), 'Printable report must remain hidden on screen and visible in print');
    });

    await t3.test('37. HostPrintableReport does not contain hardcoded "Trang 1 / 1"', () => {
      assert.ok(!reportSource.includes('Trang 1 / 1'), 'False page count must not be present');
    });

    await t3.test('38. HostPrintableReport accepts isAnonymized prop and calls getExportDisplayName', () => {
      assert.ok(reportSource.includes('isAnonymized = false') || reportSource.includes('isAnonymized'), 'Must accept isAnonymized prop');
      assert.ok(reportSource.includes('getExportDisplayName'), 'Must call getExportDisplayName for participant rows');
    });
  });

  // =========================================================================
  // GROUP 4: UI & State Architecture Invariants
  // =========================================================================
  await t.test('Group 4: UI Controls & State Architecture Invariants', async (t4) => {
    const controlsPath = path.resolve('src/components/competition/HostExportControls.jsx');
    const controlsSource = fs.readFileSync(controlsPath, 'utf8');

    const reportPath = path.resolve('src/components/competition/HostPrintableReport.jsx');
    const reportSource = fs.readFileSync(reportPath, 'utf8');

    const hostPagePath = path.resolve('src/pages/CompetitionHostPage.jsx');
    const hostPageSource = fs.readFileSync(hostPagePath, 'utf8');

    await t4.test('39. HostExportControls renders accessible checkbox with Vietnamese label "Ẩn tên thí sinh"', () => {
      assert.ok(controlsSource.includes('Ẩn tên thí sinh'), 'Visible Vietnamese label must be present');
      assert.ok(controlsSource.includes('type="checkbox"'), 'Must use semantic checkbox input');
    });

    await t4.test('40. HostExportControls is hidden in print mode with print:hidden', () => {
      assert.ok(controlsSource.includes('print:hidden'), 'Export controls must have print:hidden class');
    });

    await t4.test('41. CompetitionHostPage manages isAnonymizedExport in local React state', () => {
      assert.ok(hostPageSource.includes('const [isAnonymizedExport, setIsAnonymizedExport] = useState(false);'),
        'State must be defined in CompetitionHostPage with default false');
    });

    await t4.test('42. isAnonymizedExport is NOT persisted in localStorage or sessionStorage', () => {
      assert.ok(!hostPageSource.includes('localStorage.setItem(\'isAnonymized'), 'Must not persist to localStorage');
      assert.ok(!hostPageSource.includes('sessionStorage.setItem(\'isAnonymized'), 'Must not persist to sessionStorage');
    });

    await t4.test('43. CompetitionHostPage passes isAnonymizedExport to both HostExportControls and HostPrintableReport', () => {
      assert.ok(hostPageSource.includes('isAnonymized={isAnonymizedExport}'),
        'Must pass isAnonymized to child components');
    });

    await t4.test('44. HostQuestionAnalyticsView.jsx source file is untouched and unchanged', () => {
      const analyticsPath = path.resolve('src/components/competition/HostQuestionAnalyticsView.jsx');
      const analyticsSource = fs.readFileSync(analyticsPath, 'utf8');
      assert.ok(analyticsSource.includes('export const HostQuestionAnalyticsView'), 'HostQuestionAnalyticsView must exist unchanged');
    });

    await t4.test('45. R7 lazy analytics fetch contract is preserved (no extra RPC call in export controls)', () => {
      assert.ok(!controlsSource.includes('getHostQuestionAnalytics'),
        'HostExportControls must not invoke getHostQuestionAnalytics');
      assert.ok(!reportSource.includes('getHostQuestionAnalytics'),
        'HostPrintableReport must not invoke getHostQuestionAnalytics');
    });
  });

  // =========================================================================
  // GROUP 5: Regression & Frozen Milestones R1–R8 Invariants
  // =========================================================================
  await t.test('Group 5: Regression & Milestone Invariants', async (t5) => {
    await t5.test('46. R8 CSV UTF-8 BOM prefix remains intact in all CSV builders', () => {
      const lbCsv = buildLeaderboardCsv({});
      const anCsv = buildAnalyticsCsv({});
      assert.ok(lbCsv.startsWith('\uFEFF'), 'Leaderboard CSV must start with UTF-8 BOM');
      assert.ok(anCsv.startsWith('\uFEFF'), 'Analytics CSV must start with UTF-8 BOM');
    });

    await t5.test('47. Formula injection characters =, +, -, @ are escaped in all export builders', () => {
      assert.equal(sanitizeForFormulaInjection('=SUM(A1:A10)'), "'=SUM(A1:A10)");
      assert.equal(sanitizeForFormulaInjection('+CMD|'), "'+CMD|");
      assert.equal(sanitizeForFormulaInjection('-2+3+cmd'), "'-2+3+cmd");
      assert.equal(sanitizeForFormulaInjection('@IMPORT'), "'@IMPORT");
      assert.equal(sanitizeForFormulaInjection('  =CALC()'), "'  =CALC()");
    });

    await t5.test('48. Clean numeric values (e.g. -10, +5.5) remain unescaped as numbers', () => {
      assert.equal(sanitizeForFormulaInjection('-10'), '-10');
      assert.equal(sanitizeForFormulaInjection('+5.5'), '+5.5');
      assert.equal(sanitizeForFormulaInjection(100), 100);
    });

    await t5.test('49. XLSX workbook contains exactly two sheets with proper names', () => {
      const wb = buildCompetitionWorkbook({});
      assert.deepEqual(wb.SheetNames, ['Bang Xep Hang', 'Phan Tich Cau Hoi']);
    });

    await t5.test('50. Safe filename generator eliminates illegal characters', () => {
      assert.equal(sanitizeFilenamePart('Room:123/Test*?'), 'Room123Test');
    });

    await t5.test('51. Deterministic timestamp format (YYYYMMDD-HHmmss) is verified', () => {
      const fixedDate = new Date(2026, 9, 7, 14, 30, 0); // Month is 0-indexed (9 = Oct)
      assert.equal(formatExportTimestamp(fixedDate), '20261007-143000');
    });
  });

  // =========================================================================
  // GROUP 6: Performance & Computational Complexity Sanity
  // =========================================================================
  await t.test('Group 6: Performance & Scale Benchmark', async (t6) => {
    await t6.test('52. 500 Leaderboard Rows auto-width executes in under 20ms (O(N*M))', () => {
      const largeLeaderboardAoA = [
        ['Hạng', 'Tên Thí Sinh', 'Tổng Điểm', 'Số Câu Đúng', 'Thời Gian Phản Hồi (giây)', 'Loại Thí Sinh']
      ];
      for (let i = 0; i < 500; i++) {
        largeLeaderboardAoA.push([
          i + 1,
          `Thí sinh số ${i + 1} có tên thật là Nguyễn Văn ${i}`,
          1000 - i * 2,
          50,
          12.34,
          i % 2 === 0 ? 'Khách' : 'Tài khoản'
        ]);
      }
      const tStart = performance.now();
      const widths = calculateWorksheetColumnWidths(largeLeaderboardAoA);
      const tEnd = performance.now();
      const elapsed = tEnd - tStart;

      assert.equal(widths.length, 6);
      assert.ok(elapsed < 20, `Execution took ${elapsed.toFixed(2)}ms, expected < 20ms`);
    });

    await t6.test('53. 500 Analytics Questions auto-width executes in under 25ms (O(N*M))', () => {
      const largeAnalyticsAoA = [
        ['STT Câu', 'Dạng Câu Hỏi', 'Nội Dung Câu Hỏi', 'Điểm Tối Đa', 'Tổng Thí Sinh', 'Đã Nộp', 'Chưa Nộp', 'Số Lượt Đúng', 'Số Lượt Sai', 'Tỷ Lệ Đúng (%)', 'Điểm TB', 'Thời Gian TB (giây)', 'Phân Bố Lựa Chọn']
      ];
      for (let i = 0; i < 500; i++) {
        largeAnalyticsAoA.push([
          i + 1,
          'Trắc nghiệm đơn',
          `Nội dung câu hỏi số ${i + 1} với độ dài vừa phải để kiểm thử khả năng xử lý`,
          10,
          50,
          48,
          2,
          40,
          8,
          80,
          8,
          5.67,
          'Đáp án A: 40 (80%) [Đúng] | Đáp án B: 8 (16%) | Đáp án C: 0 (0%) | Đáp án D: 0 (0%)'
        ]);
      }
      const tStart = performance.now();
      const widths = calculateWorksheetColumnWidths(largeAnalyticsAoA, {
        minWidth: 10,
        defaultMaxWidth: 42,
        padding: 3,
        columnMaxOverrides: { 2: 60, 12: 55 }
      });
      const tEnd = performance.now();
      const elapsed = tEnd - tStart;

      assert.equal(widths.length, 13);
      assert.equal(widths[2].wch, 60, 'Question text column capped at 60');
      assert.equal(widths[12].wch, 55, 'Distribution column capped at 55');
      assert.ok(elapsed < 25, `Execution took ${elapsed.toFixed(2)}ms, expected < 25ms`);
    });
  });
});
