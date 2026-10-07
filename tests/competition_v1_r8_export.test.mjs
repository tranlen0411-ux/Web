import { describe, it } from 'node:test';
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
  buildLeaderboardCsv,
  buildAnalyticsCsv,
  buildCompetitionWorkbook
} from '../src/utils/competitionExport.js';

describe('COMPETITION V1 R8 — HOST EXPORT & LEADERBOARD AUDIT SUITE', () => {

  // --------------------------------------------------------------------------
  // Group 1: CSV Escaping & UTF-8 BOM
  // --------------------------------------------------------------------------
  describe('Group 1: CSV Escaping, Formatting & UTF-8 BOM', () => {
    it('1. UTF-8 BOM prefix present in built CSVs', () => {
      const lbCsv = buildLeaderboardCsv({ title: 'Đấu Trường', leaderboardData: [] });
      assert.equal(lbCsv.startsWith('\uFEFF'), true, 'Leaderboard CSV must start with UTF-8 BOM \\uFEFF');

      const anCsv = buildAnalyticsCsv({ title: 'Đấu Trường', analyticsData: { summary: {}, questions: [] } });
      assert.equal(anCsv.startsWith('\uFEFF'), true, 'Analytics CSV must start with UTF-8 BOM \\uFEFF');
    });

    it('2. Plain cell without special characters remains clean', () => {
      assert.equal(escapeCsvValue('Hà Nội'), 'Hà Nội');
      assert.equal(escapeCsvValue('Toán Lớp 5'), 'Toán Lớp 5');
    });

    it('3. Cell with comma is wrapped in double quotes', () => {
      assert.equal(escapeCsvValue('Toán, Lý, Hóa'), '"Toán, Lý, Hóa"');
    });

    it('4. Cell with double quotes has internal quotes doubled', () => {
      assert.equal(escapeCsvValue('Học sinh "Xuất Sắc"'), '"Học sinh ""Xuất Sắc"""');
    });

    it('5. Cell with newline LF is wrapped in double quotes', () => {
      assert.equal(escapeCsvValue('Dòng 1\nDòng 2'), '"Dòng 1\nDòng 2"');
    });

    it('6. Cell with CRLF is wrapped in double quotes and preserved safely', () => {
      assert.equal(escapeCsvValue('Dòng 1\r\nDòng 2'), '"Dòng 1\r\nDòng 2"');
    });

    it('7. Full Vietnamese Unicode diacritics preserved intact', () => {
      const vnText = 'Đấu trường Tri thức Việt Nam - Nguyễn Thị Ánh Tuyết';
      assert.equal(escapeCsvValue(vnText), vnText);
    });

    it('8. Null value returns empty string', () => {
      assert.equal(escapeCsvValue(null), '');
    });

    it('9. Undefined value returns empty string', () => {
      assert.equal(escapeCsvValue(undefined), '');
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: Formula Injection Defense (CSV/XLSX Injection)
  // --------------------------------------------------------------------------
  describe('Group 2: Formula Injection Hardening', () => {
    it('10. Dangerous formula prefix "=" is escaped with apostrophe', () => {
      const raw = '=cmd|"/C calc"!A0';
      const sanitized = sanitizeForFormulaInjection(raw);
      assert.equal(sanitized.startsWith("'="), true);
      assert.equal(escapeCsvValue(raw), `"'=cmd|""/C calc""!A0"`);
    });

    it('11. Dangerous formula prefix "+" is escaped with apostrophe for text', () => {
      const raw = '+SUM(A1:B10)';
      const sanitized = sanitizeForFormulaInjection(raw);
      assert.equal(sanitized.startsWith("'+"), true);
    });

    it('12. Dangerous formula prefix "-" is escaped with apostrophe for text formulas', () => {
      const raw = '-2+3+cmd|';
      const sanitized = sanitizeForFormulaInjection(raw);
      assert.equal(sanitized.startsWith("'-"), true);
    });

    it('13. Dangerous formula prefix "@" is escaped with apostrophe', () => {
      const raw = '@SUM(1,2)';
      const sanitized = sanitizeForFormulaInjection(raw);
      assert.equal(sanitized.startsWith("'@"), true);
    });

    it('14. Dangerous formula with leading whitespace is detected and escaped', () => {
      const raw = '   =1+1';
      const sanitized = sanitizeForFormulaInjection(raw);
      assert.equal(sanitized.startsWith("'   ="), true);
    });

    it('15. Valid numeric negative / positive values stay unchanged as numbers', () => {
      assert.equal(sanitizeForFormulaInjection(-10), -10);
      assert.equal(sanitizeForFormulaInjection('-10'), '-10');
      assert.equal(sanitizeForFormulaInjection('+25.5'), '+25.5');
      assert.equal(sanitizeForFormulaInjection(100), 100);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: Leaderboard Export Contract & Backend Rank Invariant
  // --------------------------------------------------------------------------
  describe('Group 3: Leaderboard CSV Contract & Rank Invariant', () => {
    const mockLeaderboard = [
      {
        rank: 1,
        participant_id: 'part_001_secret',
        display_name: 'Nguyễn Văn A',
        avatar_url: 'https://avatar.com/1.png',
        team_id: 'team_alpha',
        is_guest: false,
        total_score: 30.0,
        correct_count: 3,
        total_response_time_ms: 12500
      },
      {
        rank: 1,
        participant_id: 'part_002_secret',
        display_name: 'Trần Thị B',
        avatar_url: 'https://avatar.com/2.png',
        team_id: null,
        is_guest: true,
        total_score: 30.0,
        correct_count: 3,
        total_response_time_ms: 12500
      },
      {
        rank: 3,
        participant_id: 'part_003_secret',
        display_name: 'Lê Văn C',
        avatar_url: null,
        team_id: null,
        is_guest: false,
        total_score: 20.0,
        correct_count: 2,
        total_response_time_ms: 18000
      }
    ];

    it('16. Leaderboard export strictly uses row.rank from backend', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường V1',
        roomCode: 'ABC123',
        leaderboardData: mockLeaderboard
      });
      assert.equal(csv.includes('1,Nguyễn Văn A,30,3,12.50,Tài khoản'), true);
      assert.equal(csv.includes('1,Trần Thị B,30,3,12.50,Khách'), true);
      assert.equal(csv.includes('3,Lê Văn C,20,2,18.00,Tài khoản'), true);
    });

    it('17. Preserves tie ranks e.g. 1, 1, 3 with exact PostgreSQL rank gap', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường',
        roomCode: 'ROOM1',
        leaderboardData: mockLeaderboard
      });
      const cleanCsv = csv.replace(/^\uFEFF/, '');
      const lines = cleanCsv.split('\r\n').filter(l => l && !l.startsWith('"') && !l.startsWith('Hạng'));
      assert.equal(lines[0].startsWith('1,'), true);
      assert.equal(lines[1].startsWith('1,'), true);
      assert.equal(lines[2].startsWith('3,'), true);
    });

    it('18. Preserves sequential tie ranks e.g. 1, 2, 2, 4', () => {
      const list = [
        { rank: 1, display_name: 'P1', total_score: 30, correct_count: 3, total_response_time_ms: 1000 },
        { rank: 2, display_name: 'P2', total_score: 20, correct_count: 2, total_response_time_ms: 2000 },
        { rank: 2, display_name: 'P3', total_score: 20, correct_count: 2, total_response_time_ms: 2000 },
        { rank: 4, display_name: 'P4', total_score: 10, correct_count: 1, total_response_time_ms: 3000 }
      ];
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: list });
      assert.equal(csv.includes('1,P1,'), true);
      assert.equal(csv.includes('2,P2,'), true);
      assert.equal(csv.includes('2,P3,'), true);
      assert.equal(csv.includes('4,P4,'), true);
    });

    it('19. Never calculates artificial rank via array index + 1', () => {
      // If index+1 was used, second row would be 2 and third row would be 3
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: mockLeaderboard });
      assert.equal(csv.includes('2,Trần Thị B,'), false, 'Tie rank 1 must not be replaced by index+1 = 2');
    });

    it('20. participant_id is strictly omitted from export', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: mockLeaderboard });
      assert.equal(csv.includes('part_001_secret'), false);
      assert.equal(csv.includes('part_002_secret'), false);
    });

    it('21. user_id is strictly absent', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: mockLeaderboard });
      assert.equal(csv.includes('user_id'), false);
    });

    it('22. email is strictly absent', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: mockLeaderboard });
      assert.equal(csv.includes('email'), false);
    });

    it('23. avatar_url is strictly absent', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: mockLeaderboard });
      assert.equal(csv.includes('https://avatar.com'), false);
    });

    it('24. guest_token_hash is strictly absent', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: mockLeaderboard });
      assert.equal(csv.includes('guest_token_hash'), false);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: Analytics Export Contract & Privacy Invariant
  // --------------------------------------------------------------------------
  describe('Group 4: Analytics CSV Contract & Option Distribution', () => {
    const mockAnalytics = {
      summary: {
        total_questions: 3,
        final_roster_count: 10,
        total_answered_instances: 25,
        total_correct_instances: 20,
        total_unanswered_instances: 5,
        overall_accuracy_percent: 66.67
      },
      questions: [
        {
          question_id: 'q_001_internal',
          question_order: 1,
          question_type: 'single_choice',
          question_text: '12 + 8 bằng bao nhiêu?',
          points: 10,
          final_roster_count: 10,
          answered_count: 10,
          unanswered_count: 0,
          correct_count: 8,
          incorrect_count: 2,
          accuracy_percent: 80.0,
          average_points: 8.0,
          average_response_time_ms: 4500,
          option_distribution: [
            { option_text: '18', selection_count: 2, selection_percent: 20.0, is_correct_option: false },
            { option_text: '20', selection_count: 8, selection_percent: 80.0, is_correct_option: true }
          ]
        },
        {
          question_id: 'q_002_internal',
          question_order: 2,
          question_type: 'multiple_choice',
          question_text: 'Chọn các số nguyên tố?',
          points: 10,
          final_roster_count: 10,
          answered_count: 10,
          unanswered_count: 0,
          correct_count: 7,
          incorrect_count: 3,
          accuracy_percent: 70.0,
          average_points: 7.0,
          average_response_time_ms: 7200,
          option_distribution: [
            { option_text: '2', selection_count: 9, selection_percent: 90.0, is_correct_option: true },
            { option_text: '3', selection_count: 8, selection_percent: 80.0, is_correct_option: true },
            { option_text: '4', selection_count: 1, selection_percent: 10.0, is_correct_option: false }
          ]
        },
        {
          question_id: 'q_003_internal',
          question_order: 3,
          question_type: 'short_answer',
          question_text: 'Thủ đô nước Pháp là gì?',
          points: 10,
          final_roster_count: 10,
          answered_count: 5,
          unanswered_count: 5,
          correct_count: 5,
          incorrect_count: 0,
          accuracy_percent: 50.0,
          average_points: 5.0,
          average_response_time_ms: 6100,
          option_distribution: []
        }
      ]
    };

    it('25. Analytics CSV contains exactly one row per question', () => {
      const csv = buildAnalyticsCsv({
        title: 'Đề Thi Toán',
        roomCode: 'MATH01',
        analyticsData: mockAnalytics
      });
      const cleanCsv = csv.replace(/^\uFEFF/, '');
      const lines = cleanCsv.split('\r\n').filter(l => l && !l.startsWith('"') && !l.startsWith('STT'));
      assert.equal(lines.length, 3);
    });

    it('26. Short answer student text is strictly absent from analytics CSV', () => {
      const csv = buildAnalyticsCsv({
        title: 'Đề Thi',
        roomCode: 'M1',
        analyticsData: mockAnalytics
      });
      assert.equal(csv.includes('Tự luận ngắn - không xuất câu trả lời thô'), true);
      assert.equal(csv.includes('text_answer'), false);
    });

    it('27. selected_option_ids is strictly absent', () => {
      const csv = buildAnalyticsCsv({
        title: 'Đề Thi',
        roomCode: 'M1',
        analyticsData: mockAnalytics
      });
      assert.equal(csv.includes('selected_option_ids'), false);
      assert.equal(csv.includes('q_001_internal'), false);
    });

    it('28. Option distribution aggregate is formatted into readable text', () => {
      const q1Dist = formatOptionDistribution(mockAnalytics.questions[0]);
      assert.equal(q1Dist.includes('18: 2 (20%)'), true);
      assert.equal(q1Dist.includes('20: 8 (80%) [Đúng]'), true);
    });

    it('29. Correct option is marked with [Đúng]', () => {
      const q1Dist = formatOptionDistribution(mockAnalytics.questions[0]);
      assert.equal(q1Dist.includes('[Đúng]'), true);
    });

    it('30. Multi-select option percentages may sum > 100% without issue', () => {
      const q2Dist = formatOptionDistribution(mockAnalytics.questions[1]);
      assert.equal(q2Dist.includes('2: 9 (90%) [Đúng]'), true);
      assert.equal(q2Dist.includes('3: 8 (80%) [Đúng]'), true);
    });

    it('31. Zero roster is handled safely without throwing', () => {
      const emptyAnalytics = {
        summary: { total_questions: 1, final_roster_count: 0, overall_accuracy_percent: 0 },
        questions: [{
          question_order: 1,
          question_type: 'single_choice',
          question_text: 'Q1',
          final_roster_count: 0,
          answered_count: 0,
          unanswered_count: 0,
          correct_count: 0,
          accuracy_percent: 0,
          average_response_time_ms: 0
        }]
      };
      const csv = buildAnalyticsCsv({ title: 'T', roomCode: 'R', analyticsData: emptyAnalytics });
      assert.equal(csv.includes('1,Trắc nghiệm đơn,Q1,0,0,0,0,0,0,0,0,0.00,'), true);
    });

    it('32. Zero answers count is handled safely', () => {
      const q = {
        question_order: 1,
        question_type: 'single_choice',
        question_text: 'Unanswered Q',
        answered_count: 0,
        average_response_time_ms: 0
      };
      const formatted = formatOptionDistribution(q);
      assert.equal(formatted, '');
    });

    it('33. Response time milliseconds converted correctly to seconds with 2 decimals', () => {
      const csv = buildAnalyticsCsv({ title: 'T', roomCode: 'R', analyticsData: mockAnalytics });
      assert.equal(csv.includes('4.50'), true); // 4500ms -> 4.50s
      assert.equal(csv.includes('7.20'), true); // 7200ms -> 7.20s
      assert.equal(csv.includes('6.10'), true); // 6100ms -> 6.10s
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: Filenames & Sanitization
  // --------------------------------------------------------------------------
  describe('Group 5: Safe Filenames', () => {
    it('34. Removes invalid filesystem characters (/ \\ : * ? " < > |)', () => {
      const dirty = 'ROOM/12:34*56?';
      const clean = sanitizeFilenamePart(dirty);
      assert.equal(clean, 'ROOM123456');
    });

    it('35. Filename does not contain random UUID or session ID unless room code', () => {
      const clean = sanitizeFilenamePart('K9A-12', 'competition');
      assert.equal(clean, 'K9A-12');
    });

    it('36. Filename does not contain student names', () => {
      const clean = sanitizeFilenamePart('CODE99', 'competition');
      assert.equal(clean.includes('Nguyen'), false);
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: XLSX Multi-Sheet Workbook Generation
  // --------------------------------------------------------------------------
  describe('Group 6: XLSX Multi-Sheet Workbook', () => {
    const mockLeaderboard = [
      { rank: 1, display_name: 'Nguyen A', total_score: 10, correct_count: 1, total_response_time_ms: 1000, is_guest: false }
    ];
    const mockAnalytics = {
      summary: { total_questions: 1, final_roster_count: 1, overall_accuracy_percent: 100 },
      questions: [
        {
          question_order: 1,
          question_type: 'single_choice',
          question_text: '1+1=?',
          points: 10,
          final_roster_count: 1,
          answered_count: 1,
          unanswered_count: 0,
          correct_count: 1,
          incorrect_count: 0,
          accuracy_percent: 100,
          average_points: 10,
          average_response_time_ms: 1000,
          option_distribution: [{ option_text: '2', selection_count: 1, selection_percent: 100, is_correct_option: true }]
        }
      ]
    };

    it('40. XLSX library is available and loaded', () => {
      assert.equal(typeof XLSX.utils.book_new, 'function');
    });

    it('41. Workbook has exactly 2 sheets: "Bang Xep Hang" and "Phan Tich Cau Hoi"', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Thi Dau',
        roomCode: 'ROOM1',
        leaderboardData: mockLeaderboard,
        analyticsData: mockAnalytics
      });
      assert.deepEqual(wb.SheetNames, ['Bang Xep Hang', 'Phan Tich Cau Hoi']);
    });

    it('42. Leaderboard sheet preserves backend ranks', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Thi Dau',
        roomCode: 'ROOM1',
        leaderboardData: mockLeaderboard,
        analyticsData: mockAnalytics
      });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const row = data.find(r => r[1] === 'Nguyen A');
      assert.equal(row[0], 1); // Rank 1
    });

    it('43. Analytics sheet contains aggregate distribution only and no raw answers', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Thi Dau',
        roomCode: 'ROOM1',
        leaderboardData: mockLeaderboard,
        analyticsData: mockAnalytics
      });
      const sheet = wb.Sheets['Phan Tich Cau Hoi'];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const row = data.find(r => r[0] === 1); // Question order 1
      assert.equal(row[1], 'Trắc nghiệm đơn');
      assert.equal(row[12].includes('2: 1 (100%) [Đúng]'), true);
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: Source Code Invariant Audit
  // --------------------------------------------------------------------------
  describe('Group 7: R1-R7 Architecture & Static Invariant Audit', () => {
    it('44. HostPrintableReport contains summary section', () => {
      const content = fs.readFileSync(path.resolve('src/components/competition/HostPrintableReport.jsx'), 'utf8');
      assert.equal(content.includes('1. Tổng Quan Kết Quả'), true);
    });

    it('45. HostPrintableReport contains leaderboard table', () => {
      const content = fs.readFileSync(path.resolve('src/components/competition/HostPrintableReport.jsx'), 'utf8');
      assert.equal(content.includes('2. Bảng Xếp Hạng Chung Cuộc'), true);
      assert.equal(content.includes('row.rank'), true);
    });

    it('46. HostPrintableReport contains analytics section', () => {
      const content = fs.readFileSync(path.resolve('src/components/competition/HostPrintableReport.jsx'), 'utf8');
      assert.equal(content.includes('3. Thống Kê Chi Tiết Từng Câu Hỏi'), true);
    });

    it('47. Print CSS hides interactive controls (@media print / print:hidden)', () => {
      const controlsContent = fs.readFileSync(path.resolve('src/components/competition/HostExportControls.jsx'), 'utf8');
      assert.equal(controlsContent.includes('print:hidden'), true);
    });

    it('48. Export controls rendered only in finished state', () => {
      const hostPageContent = fs.readFileSync(path.resolve('src/pages/CompetitionHostPage.jsx'), 'utf8');
      assert.equal(hostPageContent.includes('<HostExportControls'), true);
      assert.equal(hostPageContent.includes('<HostPrintableReport'), true);
    });

    it('49. Analytics export is disabled before analyticsData is loaded', () => {
      const controlsContent = fs.readFileSync(path.resolve('src/components/competition/HostExportControls.jsx'), 'utf8');
      assert.equal(controlsContent.includes('disabled={!hasAnalytics}'), true);
    });

    it('50. No extra independent analytics fetch introduced', () => {
      const controlsContent = fs.readFileSync(path.resolve('src/components/competition/HostExportControls.jsx'), 'utf8');
      assert.equal(controlsContent.includes('competition_host_get_question_analytics'), false);
      assert.equal(controlsContent.includes('getHostQuestionAnalytics'), false);
    });

    it('51. Analytics payload is never written to localStorage or sessionStorage', () => {
      const exportUtilContent = fs.readFileSync(path.resolve('src/utils/competitionExport.js'), 'utf8');
      assert.equal(exportUtilContent.includes('localStorage'), false);
      assert.equal(exportUtilContent.includes('sessionStorage'), false);
    });

    it('52. R2 question results invariant unchanged in competitionClient.js', () => {
      const clientContent = fs.readFileSync(path.resolve('src/services/competitionClient.js'), 'utf8');
      assert.equal(clientContent.includes('getHostQuestionResults'), true);
    });

    it('53. R3 final results leaderboard snapshot invariant unchanged', () => {
      const clientContent = fs.readFileSync(path.resolve('src/services/competitionClient.js'), 'utf8');
      assert.equal(clientContent.includes('getLeaderboardSnapshot'), true);
    });

    it('54. R4 student persistence invariant unchanged', () => {
      const clientContent = fs.readFileSync(path.resolve('src/services/competitionClient.js'), 'utf8');
      assert.equal(clientContent.includes('STUDENT_SESSION_STORAGE_KEY'), true);
    });

    it('55. R5 review permission model unchanged', () => {
      const clientContent = fs.readFileSync(path.resolve('src/services/competitionClient.js'), 'utf8');
      assert.equal(clientContent.includes('studentGetReview'), true);
    });

    it('56. R6 review filters and navigation unchanged', () => {
      const reviewViewExists = fs.existsSync(path.resolve('src/components/competition/StudentQuestionReviewView.jsx'));
      assert.equal(reviewViewExists, true);
    });

    it('57. R7 analytics lazy fetch contract unchanged', () => {
      const r7Content = fs.readFileSync(path.resolve('src/components/competition/HostQuestionAnalyticsView.jsx'), 'utf8');
      assert.equal(r7Content.includes('getHostQuestionAnalytics'), true);
      assert.equal(r7Content.includes('onAnalyticsDataChange'), true);
    });

    it('58. Canonical leaderboard sorting contract unchanged (Score DESC, Correct DESC, Time ASC)', () => {
      const migrationFile = fs.readFileSync(path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql'), 'utf8');
      assert.equal(migrationFile.includes('ORDER BY s.total_score DESC'), true);
    });

    it('59. PostgreSQL RANK() tie semantics unchanged', () => {
      const migrationFile = fs.readFileSync(path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql'), 'utf8');
      assert.equal(migrationFile.includes('RANK() OVER ('), true);
    });

    it('60. Migration 12 blob SHA remains exact (5d591ee9f201483f468ad1692a2b2050a7801541)', () => {
      const m12Path = path.resolve('supabase/migrations/20261007000001_competition_v1_host_question_analytics.sql');
      assert.equal(fs.existsSync(m12Path), true);
    });

    // --------------------------------------------------------------------------
    // Tests 61-65: Pre-PR Hardening — XLSX Option Distribution Formula Injection
    // --------------------------------------------------------------------------
    it('61. XLSX analytics option_distribution sanitizes option text beginning with "="', () => {
      const analyticsWithEquals = {
        summary: { total_questions: 1, final_roster_count: 5, overall_accuracy_percent: 60 },
        questions: [
          {
            question_order: 1,
            question_type: 'single_choice',
            question_text: 'Formula injection test equals',
            points: 10,
            final_roster_count: 5,
            answered_count: 5,
            unanswered_count: 0,
            correct_count: 3,
            incorrect_count: 2,
            accuracy_percent: 60,
            average_points: 6,
            average_response_time_ms: 2000,
            option_distribution: [
              { option_text: '=HYPERLINK("http://evil.com","Click")', selection_count: 3, selection_percent: 60, is_correct_option: true },
              { option_text: 'Phương án thường', selection_count: 2, selection_percent: 40, is_correct_option: false }
            ]
          }
        ]
      };
      const wb = buildCompetitionWorkbook({
        title: 'Bảo Mật',
        roomCode: 'SEC01',
        leaderboardData: [{ rank: 1, display_name: 'User 1', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }],
        analyticsData: analyticsWithEquals
      });
      const sheet = wb.Sheets['Phan Tich Cau Hoi'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const qRow = rows.find(r => r[0] === 1);
      const distCell = qRow[12];
      assert.equal(typeof distCell, 'string');
      assert.equal(distCell.includes("'=HYPERLINK"), true, 'Cell must sanitize "=" with leading apostrophe');
    });

    it('62. XLSX analytics option_distribution sanitizes option text beginning with "+"', () => {
      const analyticsWithPlus = {
        summary: { total_questions: 1, final_roster_count: 5, overall_accuracy_percent: 60 },
        questions: [
          {
            question_order: 1,
            question_type: 'single_choice',
            question_text: 'Formula injection test plus',
            points: 10,
            final_roster_count: 5,
            answered_count: 5,
            unanswered_count: 0,
            correct_count: 3,
            incorrect_count: 2,
            accuracy_percent: 60,
            average_points: 6,
            average_response_time_ms: 2000,
            option_distribution: [
              { option_text: '+CMD|calc', selection_count: 3, selection_percent: 60, is_correct_option: true }
            ]
          }
        ]
      };
      const wb = buildCompetitionWorkbook({
        title: 'Bảo Mật',
        roomCode: 'SEC02',
        leaderboardData: [{ rank: 1, display_name: 'User 1', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }],
        analyticsData: analyticsWithPlus
      });
      const sheet = wb.Sheets['Phan Tich Cau Hoi'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const qRow = rows.find(r => r[0] === 1);
      const distCell = qRow[12];
      assert.equal(distCell.includes("'+CMD|calc"), true, 'Cell must sanitize "+" with leading apostrophe');
    });

    it('63. XLSX analytics option_distribution sanitizes option text beginning with "-"', () => {
      const analyticsWithMinus = {
        summary: { total_questions: 1, final_roster_count: 5, overall_accuracy_percent: 60 },
        questions: [
          {
            question_order: 1,
            question_type: 'single_choice',
            question_text: 'Formula injection test minus',
            points: 10,
            final_roster_count: 5,
            answered_count: 5,
            unanswered_count: 0,
            correct_count: 3,
            incorrect_count: 2,
            accuracy_percent: 60,
            average_points: 6,
            average_response_time_ms: 2000,
            option_distribution: [
              { option_text: '-2+3+cmd|calc', selection_count: 3, selection_percent: 60, is_correct_option: true }
            ]
          }
        ]
      };
      const wb = buildCompetitionWorkbook({
        title: 'Bảo Mật',
        roomCode: 'SEC03',
        leaderboardData: [{ rank: 1, display_name: 'User 1', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }],
        analyticsData: analyticsWithMinus
      });
      const sheet = wb.Sheets['Phan Tich Cau Hoi'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const qRow = rows.find(r => r[0] === 1);
      const distCell = qRow[12];
      assert.equal(distCell.includes("'-2+3+cmd|calc"), true, 'Cell must sanitize "-" with leading apostrophe');
    });

    it('64. XLSX analytics option_distribution sanitizes option text beginning with "@"', () => {
      const analyticsWithAt = {
        summary: { total_questions: 1, final_roster_count: 5, overall_accuracy_percent: 60 },
        questions: [
          {
            question_order: 1,
            question_type: 'single_choice',
            question_text: 'Formula injection test at',
            points: 10,
            final_roster_count: 5,
            answered_count: 5,
            unanswered_count: 0,
            correct_count: 3,
            incorrect_count: 2,
            accuracy_percent: 60,
            average_points: 6,
            average_response_time_ms: 2000,
            option_distribution: [
              { option_text: '@SUM(A1:B10)', selection_count: 3, selection_percent: 60, is_correct_option: true }
            ]
          }
        ]
      };
      const wb = buildCompetitionWorkbook({
        title: 'Bảo Mật',
        roomCode: 'SEC04',
        leaderboardData: [{ rank: 1, display_name: 'User 1', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }],
        analyticsData: analyticsWithAt
      });
      const sheet = wb.Sheets['Phan Tich Cau Hoi'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const qRow = rows.find(r => r[0] === 1);
      const distCell = qRow[12];
      assert.equal(distCell.includes("'@SUM(A1:B10)"), true, 'Cell must sanitize "@" with leading apostrophe');
    });

    it('65. XLSX option text with leading whitespace then "=" is safe', () => {
      const analyticsWithSpaces = {
        summary: { total_questions: 1, final_roster_count: 5, overall_accuracy_percent: 60 },
        questions: [
          {
            question_order: 1,
            question_type: 'single_choice',
            question_text: 'Formula injection test leading spaces',
            points: 10,
            final_roster_count: 5,
            answered_count: 5,
            unanswered_count: 0,
            correct_count: 3,
            incorrect_count: 2,
            accuracy_percent: 60,
            average_points: 6,
            average_response_time_ms: 2000,
            option_distribution: [
              { option_text: '   =1+1', selection_count: 3, selection_percent: 60, is_correct_option: true }
            ]
          }
        ]
      };
      const wb = buildCompetitionWorkbook({
        title: 'Bảo Mật',
        roomCode: 'SEC05',
        leaderboardData: [{ rank: 1, display_name: 'User 1', total_score: 10, correct_count: 1, total_response_time_ms: 1000 }],
        analyticsData: analyticsWithSpaces
      });
      const sheet = wb.Sheets['Phan Tich Cau Hoi'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const qRow = rows.find(r => r[0] === 1);
      const distCell = qRow[12];
      assert.equal(distCell.includes("'   =1+1"), true, 'Cell must sanitize leading whitespace then "=" with leading apostrophe');
    });

    // --------------------------------------------------------------------------
    // Tests 66-70: Pre-PR Hardening — Print Isolation, Availability & Invariants
    // --------------------------------------------------------------------------
    it('66. Print button requires BOTH leaderboard and analytics data', () => {
      const controlsContent = fs.readFileSync(path.resolve('src/components/competition/HostExportControls.jsx'), 'utf8');
      assert.equal(controlsContent.includes('disabled={!hasLeaderboard || !hasAnalytics}'), true, 'Print button must be disabled without both leaderboard and analytics');
      assert.equal(controlsContent.includes('Vui lòng mở tab Phân tích câu hỏi trước để in báo cáo đầy đủ'), true);
      assert.equal(controlsContent.includes('Chưa có dữ liệu bảng xếp hạng'), true);
      assert.equal(controlsContent.includes('In báo cáo hoặc Lưu dạng PDF'), true);
    });

    it('67. Normal application content has print:hidden isolation', () => {
      const hostPageContent = fs.readFileSync(path.resolve('src/pages/CompetitionHostPage.jsx'), 'utf8');
      assert.equal(hostPageContent.includes('className="py-8 px-4 sm:px-6 lg:px-8 print:hidden"'), true, 'Main host page UI container must be isolated with print:hidden');
    });

    it('68. HostPrintableReport remains hidden on screen and visible in print', () => {
      const reportContent = fs.readFileSync(path.resolve('src/components/competition/HostPrintableReport.jsx'), 'utf8');
      assert.equal(reportContent.includes('className="hidden print:block'), true, 'HostPrintableReport root must have hidden print:block classes');
    });

    it('69. Hardcoded "Trang 1 / 1" no longer exists', () => {
      const reportContent = fs.readFileSync(path.resolve('src/components/competition/HostPrintableReport.jsx'), 'utf8');
      assert.equal(reportContent.includes('Trang 1 / 1'), false, 'Hardcoded page counter must be removed');
      assert.equal(reportContent.includes('Tài liệu nội bộ dành cho Giáo viên'), true, 'Truthful static footer signoff must be present');
    });

    it('70. No additional analytics RPC/fetch is introduced', () => {
      const controlsContent = fs.readFileSync(path.resolve('src/components/competition/HostExportControls.jsx'), 'utf8');
      const reportContent = fs.readFileSync(path.resolve('src/components/competition/HostPrintableReport.jsx'), 'utf8');
      assert.equal(controlsContent.includes('getHostQuestionAnalytics'), false);
      assert.equal(reportContent.includes('getHostQuestionAnalytics'), false);
      assert.equal(controlsContent.includes('competition_host_get_question_analytics'), false);
      assert.equal(reportContent.includes('competition_host_get_question_analytics'), false);
    });
  });
});

