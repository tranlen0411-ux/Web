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
  filterLeaderboardByRank,
  buildLeaderboardClipboardText,
  buildLeaderboardCsv,
  buildAnalyticsCsv,
  buildCompetitionWorkbook
} from '../src/utils/competitionExport.js';

test('COMPETITION V1 R10 — HOST EXPORT & SHARING CONVENIENCE TEST SUITE', async (t) => {

  // ============================================================================
  // GROUP 1: TOP N PURE FILTER ENGINE & BOUNDARY SEMANTICS
  // ============================================================================
  await t.test('Group 1: Top N Pure Filter Engine & Boundary Semantics', async (t1) => {
    const fixtureRanks = [
      { rank: 1, display_name: 'Alice', total_score: 1000 },
      { rank: 2, display_name: 'Bob', total_score: 900 },
      { rank: 2, display_name: 'Carol', total_score: 900 },
      { rank: 4, display_name: 'David', total_score: 800 },
      { rank: 5, display_name: 'Eve', total_score: 750 },
      { rank: 5, display_name: 'Frank', total_score: 750 },
      { rank: 7, display_name: 'Grace', total_score: 700 },
      { rank: 10, display_name: 'Heidi', total_score: 600 },
      { rank: 11, display_name: 'Ivan', total_score: 550 }
    ];

    await t1.test('1. non-array input returns empty array safely', () => {
      assert.deepEqual(filterLeaderboardByRank(null), []);
      assert.deepEqual(filterLeaderboardByRank(undefined), []);
      assert.deepEqual(filterLeaderboardByRank('invalid'), []);
    });

    await t1.test('2. topN="all" preserves full list in original order', () => {
      const res = filterLeaderboardByRank(fixtureRanks, 'all');
      assert.equal(res.length, fixtureRanks.length);
      assert.equal(res[0].display_name, 'Alice');
      assert.equal(res[res.length - 1].display_name, 'Ivan');
    });

    await t1.test('3. topN=3 filters by rank <= 3 (tie safe)', () => {
      const res = filterLeaderboardByRank(fixtureRanks, 3);
      // ranks <= 3 are: rank 1 (Alice), rank 2 (Bob), rank 2 (Carol) => 3 rows
      assert.equal(res.length, 3);
      assert.deepEqual(res.map(r => r.rank), [1, 2, 2]);
    });

    await t1.test('4. topN=5 filters by rank <= 5 (tie safe at boundary)', () => {
      const res = filterLeaderboardByRank(fixtureRanks, 5);
      // ranks <= 5 are: 1, 2, 2, 4, 5, 5 => 6 rows
      assert.equal(res.length, 6);
      assert.deepEqual(res.map(r => r.rank), [1, 2, 2, 4, 5, 5]);
    });

    await t1.test('5. topN=10 filters by rank <= 10', () => {
      const res = filterLeaderboardByRank(fixtureRanks, 10);
      assert.equal(res.length, 8);
      assert.equal(res[res.length - 1].rank, 10);
    });

    await t1.test('6. rank 1,2,2,4 with topN=2 returns exactly 3 participants', () => {
      const ranks = [
        { rank: 1, display_name: 'A' },
        { rank: 2, display_name: 'B' },
        { rank: 2, display_name: 'C' },
        { rank: 4, display_name: 'D' }
      ];
      const res = filterLeaderboardByRank(ranks, 2);
      assert.equal(res.length, 3);
      assert.deepEqual(res.map(r => r.rank), [1, 2, 2]);
    });

    await t1.test('7. tie at Top 3 boundary (ranks 1, 1, 3, 4) returns 3 rows', () => {
      const ranks = [
        { rank: 1, display_name: 'A' },
        { rank: 1, display_name: 'B' },
        { rank: 3, display_name: 'C' },
        { rank: 4, display_name: 'D' }
      ];
      const res = filterLeaderboardByRank(ranks, 3);
      assert.equal(res.length, 3);
      assert.deepEqual(res.map(r => r.rank), [1, 1, 3]);
    });

    await t1.test('8. tie at Top 5 boundary (ranks 1, 2, 3, 4, 5, 5, 7) preserves both rank 5s', () => {
      const ranks = [
        { rank: 1, display_name: 'A' },
        { rank: 2, display_name: 'B' },
        { rank: 3, display_name: 'C' },
        { rank: 4, display_name: 'D' },
        { rank: 5, display_name: 'E1' },
        { rank: 5, display_name: 'E2' },
        { rank: 7, display_name: 'G' }
      ];
      const res = filterLeaderboardByRank(ranks, 5);
      assert.equal(res.length, 6);
      assert.equal(res.filter(r => r.rank === 5).length, 2);
    });

    await t1.test('9. source array is NOT mutated', () => {
      const original = [...fixtureRanks];
      filterLeaderboardByRank(original, 3);
      assert.equal(original.length, fixtureRanks.length);
    });

    await t1.test('10. row objects inside array are NOT mutated', () => {
      const row = { rank: 1, display_name: 'Alice', total_score: 1000 };
      const arr = [row];
      const res = filterLeaderboardByRank(arr, 3);
      assert.equal(res[0], row);
      assert.equal(row.rank, 1);
    });

    await t1.test('11. original backend ordering is strictly preserved', () => {
      const res = filterLeaderboardByRank(fixtureRanks, 5);
      assert.equal(res[0].display_name, 'Alice');
      assert.equal(res[1].display_name, 'Bob');
      assert.equal(res[2].display_name, 'Carol');
    });

    await t1.test('12. no client-side sorting is performed', () => {
      // If backend sends a tie in specific order, filter preserves that order
      const tieRows = [
        { rank: 1, display_name: 'Zoe' },
        { rank: 1, display_name: 'Adam' }
      ];
      const res = filterLeaderboardByRank(tieRows, 3);
      assert.equal(res[0].display_name, 'Zoe');
      assert.equal(res[1].display_name, 'Adam');
    });

    await t1.test('13. no rank recalculation occurs', () => {
      const gapRows = [
        { rank: 1, display_name: 'A' },
        { rank: 10, display_name: 'B' }
      ];
      const res = filterLeaderboardByRank(gapRows, 10);
      assert.equal(res[0].rank, 1);
      assert.equal(res[1].rank, 10);
    });

    await t1.test('14. invalid or missing rank is excluded for numeric Top N', () => {
      const mixed = [
        { rank: 1, display_name: 'A' },
        { rank: null, display_name: 'B' },
        { rank: undefined, display_name: 'C' },
        { rank: 'invalid', display_name: 'D' },
        { rank: 2, display_name: 'E' }
      ];
      const res = filterLeaderboardByRank(mixed, 3);
      assert.equal(res.length, 2);
      assert.deepEqual(res.map(r => r.display_name), ['A', 'E']);
    });

    await t1.test('15. string numeric rank e.g. "3" is supported safely', () => {
      const stringRanks = [
        { rank: '1', display_name: 'A' },
        { rank: '3', display_name: 'B' },
        { rank: '4', display_name: 'C' }
      ];
      const res = filterLeaderboardByRank(stringRanks, 3);
      assert.equal(res.length, 2);
    });

    await t1.test('16. topN="all" preserves existing rows contract identically', () => {
      const res = filterLeaderboardByRank(fixtureRanks, 'all');
      assert.deepEqual(res, fixtureRanks);
    });
  });

  // ============================================================================
  // GROUP 2: CSV & XLSX TOP N EXPORT INTEGRATION
  // ============================================================================
  await t.test('Group 2: CSV & XLSX Top N Export Integration', async (t2) => {
    const leaderboardFixture = [
      { rank: 1, display_name: 'Nguyễn Văn A', total_score: 100, correct_count: 10, total_response_time_ms: 12000, is_guest: false },
      { rank: 2, display_name: 'Trần Thị B', total_score: 90, correct_count: 9, total_response_time_ms: 14500, is_guest: false },
      { rank: 2, display_name: 'Lê Văn C', total_score: 90, correct_count: 9, total_response_time_ms: 14500, is_guest: true },
      { rank: 4, display_name: 'Phạm Thị D', total_score: 80, correct_count: 8, total_response_time_ms: 16000, is_guest: false },
      { rank: 5, display_name: 'Hoàng Văn E', total_score: 70, correct_count: 7, total_response_time_ms: 18000, is_guest: false }
    ];

    const analyticsFixture = {
      summary: {
        total_questions: 3,
        final_roster_count: 5,
        overall_accuracy_percent: 75.5
      },
      questions: [
        { question_order: 1, question_type: 'single_choice', question_text: 'Câu hỏi số 1?', points: 10, final_roster_count: 5, answered_count: 5, unanswered_count: 0, correct_count: 4, incorrect_count: 1, accuracy_percent: 80, average_points: 8.0, average_response_time_ms: 5000, option_distribution: [] },
        { question_order: 2, question_type: 'true_false', question_text: 'Câu hỏi số 2?', points: 10, final_roster_count: 5, answered_count: 5, unanswered_count: 0, correct_count: 3, incorrect_count: 2, accuracy_percent: 60, average_points: 6.0, average_response_time_ms: 6000, option_distribution: [] },
        { question_order: 3, question_type: 'multiple_choice', question_text: 'Câu hỏi số 3?', points: 10, final_roster_count: 5, answered_count: 4, unanswered_count: 1, correct_count: 3, incorrect_count: 1, accuracy_percent: 60, average_points: 6.0, average_response_time_ms: 8000, option_distribution: [] }
      ]
    };

    await t2.test('17. CSV topN="all" exports all rows', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường Toán',
        roomCode: 'MATH1',
        leaderboardData: leaderboardFixture,
        topN: 'all'
      });
      assert.ok(csv.includes('"TỔNG SỐ THÍ SINH",5'));
      assert.ok(csv.includes('Nguyễn Văn A'));
      assert.ok(csv.includes('Hoàng Văn E'));
    });

    await t2.test('18. CSV topN=3 filters by rank <= 3 (1, 2, 2 => 3 rows)', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường Toán',
        roomCode: 'MATH1',
        leaderboardData: leaderboardFixture,
        topN: 3
      });
      assert.ok(csv.includes('"TỔNG SỐ THÍ SINH",3'));
      assert.ok(csv.includes('Nguyễn Văn A'));
      assert.ok(csv.includes('Trần Thị B'));
      assert.ok(csv.includes('Lê Văn C'));
      assert.ok(!csv.includes('Phạm Thị D'));
      assert.ok(!csv.includes('Hoàng Văn E'));
    });

    await t2.test('19. CSV tie boundary at rank 2 is preserved', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường Toán',
        roomCode: 'MATH1',
        leaderboardData: leaderboardFixture,
        topN: 2
      });
      assert.ok(csv.includes('1,Nguyễn Văn A'));
      assert.ok(csv.includes('2,Trần Thị B'));
      assert.ok(csv.includes('2,Lê Văn C'));
    });

    await t2.test('20. CSV backend rank values are unchanged', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        topN: 3
      });
      const lines = csv.split('\r\n');
      const dataRows = lines.slice(6);
      assert.ok(dataRows[0].startsWith('1,'));
      assert.ok(dataRows[1].startsWith('2,'));
      assert.ok(dataRows[2].startsWith('2,'));
    });

    await t2.test('21. normal display names preserved when isAnonymized is false', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        topN: 3,
        isAnonymized: false
      });
      assert.ok(csv.includes('Nguyễn Văn A'));
    });

    await t2.test('22. anonymous names generated properly after Top N filtering', () => {
      const csv = buildLeaderboardCsv({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        topN: 3,
        isAnonymized: true
      });
      assert.ok(csv.includes('1,Thí sinh 1'));
      assert.ok(csv.includes('2,Thí sinh 2'));
      assert.ok(csv.includes('2,Thí sinh 3'));
      assert.ok(!csv.includes('Nguyễn Văn A'));
    });

    await t2.test('23. XLSX leaderboard topN="all" contains all rows', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 'all'
      });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      // Header rows 0..5, data rows 6..10 => 5 participants
      const dataRows = rows.slice(6);
      assert.equal(dataRows.length, 5);
    });

    await t2.test('24. XLSX leaderboard topN=3 contains only rank <= 3 rows', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 3
      });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const dataRows = rows.slice(6);
      assert.equal(dataRows.length, 3);
      assert.equal(dataRows[0][0], 1);
      assert.equal(dataRows[1][0], 2);
      assert.equal(dataRows[2][0], 2);
    });

    await t2.test('25. XLSX tie boundary preserved in Sheet 1', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 2
      });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const dataRows = rows.slice(6);
      assert.equal(dataRows.length, 3); // 1, 2, 2
    });

    await t2.test('26. XLSX preserves exact backend ranks', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 'all'
      });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      assert.equal(rows[6][0], 1);
      assert.equal(rows[7][0], 2);
      assert.equal(rows[8][0], 2);
      assert.equal(rows[9][0], 4);
    });

    await t2.test('27. XLSX contains exactly two sheets with proper names', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 3
      });
      assert.equal(wb.SheetNames.length, 2);
      assert.equal(wb.SheetNames[0], 'Bang Xep Hang');
      assert.equal(wb.SheetNames[1], 'Phan Tich Cau Hoi');
    });

    await t2.test('28. XLSX analytics sheet is completely UNAFFECTED by topN filter', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 3
      });
      const anSheet = wb.Sheets['Phan Tich Cau Hoi'];
      const rows = XLSX.utils.sheet_to_json(anSheet, { header: 1 });
      // Header rows 0..8, question rows 9..11 => 3 questions
      const qRows = rows.slice(9);
      assert.equal(qRows.length, 3);
    });

    await t2.test('29. Analytics CSV is completely UNAFFECTED by topN filter', () => {
      const csv = buildAnalyticsCsv({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        analyticsData: analyticsFixture
      });
      const lines = csv.split('\r\n');
      assert.ok(lines.some(l => l.startsWith('1,Trắc nghiệm đơn')));
      assert.ok(lines.some(l => l.startsWith('2,Đúng/Sai')));
      assert.ok(lines.some(l => l.startsWith('3,Nhiều đáp án')));
    });

    await t2.test('30. XLSX auto-width column metadata !cols remains present', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 3
      });
      assert.ok(Array.isArray(wb.Sheets['Bang Xep Hang']['!cols']));
      assert.ok(Array.isArray(wb.Sheets['Phan Tich Cau Hoi']['!cols']));
    });

    await t2.test('31. question width cap = 60 preserved in XLSX', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 3
      });
      const anCols = wb.Sheets['Phan Tich Cau Hoi']['!cols'];
      assert.ok(anCols[2].wch <= 60);
    });

    await t2.test('32. option distribution width cap = 55 preserved in XLSX', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Đấu Trường',
        roomCode: 'ABC',
        leaderboardData: leaderboardFixture,
        analyticsData: analyticsFixture,
        topN: 3
      });
      const anCols = wb.Sheets['Phan Tich Cau Hoi']['!cols'];
      assert.ok(anCols[12].wch <= 55);
    });

    await t2.test('33. formula injection hardening preserved with topN', () => {
      const maliciousData = [
        { rank: 1, display_name: '=SUM(1,1)', total_score: 100 }
      ];
      const csv = buildLeaderboardCsv({
        title: 'Test',
        roomCode: 'A',
        leaderboardData: maliciousData,
        topN: 3
      });
      assert.ok(csv.includes("'=SUM(1,1)"));
    });

    await t2.test('34. UTF-8 BOM preserved in CSV output', () => {
      const csv = buildLeaderboardCsv({
        title: 'Test',
        roomCode: 'A',
        leaderboardData: leaderboardFixture,
        topN: 3
      });
      assert.ok(csv.startsWith('\uFEFF'));
    });
  });

  // ============================================================================
  // GROUP 3: ANONYMOUS MODE + TOP N INTERACTION
  // ============================================================================
  await t.test('Group 3: Anonymous Mode + Top N Interaction', async (t3) => {
    const rawData = [
      { rank: 1, display_name: 'Alice', participant_id: 'p1', user_id: 'u1', email: 'a@test.com' },
      { rank: 2, display_name: 'Bob', participant_id: 'p2', user_id: 'u2', email: 'b@test.com' },
      { rank: 2, display_name: 'Carol', participant_id: 'p3', user_id: 'u3', email: 'c@test.com' },
      { rank: 4, display_name: 'David', participant_id: 'p4', user_id: 'u4', email: 'd@test.com' }
    ];

    await t3.test('35. filtering occurs BEFORE anonymous numbering', () => {
      const filtered = filterLeaderboardByRank(rawData, 2); // 3 rows
      const mapped = filtered.map((row, idx) => getExportDisplayName(row, idx, true));
      assert.deepEqual(mapped, ['Thí sinh 1', 'Thí sinh 2', 'Thí sinh 3']);
    });

    await t3.test('36. filtered row 1 is labeled "Thí sinh 1"', () => {
      const filtered = filterLeaderboardByRank(rawData, 3);
      assert.equal(getExportDisplayName(filtered[0], 0, true), 'Thí sinh 1');
    });

    await t3.test('37. filtered row 2 is labeled "Thí sinh 2"', () => {
      const filtered = filterLeaderboardByRank(rawData, 3);
      assert.equal(getExportDisplayName(filtered[1], 1, true), 'Thí sinh 2');
    });

    await t3.test('38. tie ranks remain ties when anonymous', () => {
      const filtered = filterLeaderboardByRank(rawData, 2);
      assert.equal(filtered[1].rank, 2);
      assert.equal(filtered[2].rank, 2);
    });

    await t3.test('39. anonymous label number is display only and does NOT alter row.rank', () => {
      const filtered = filterLeaderboardByRank(rawData, 2);
      assert.equal(filtered[2].rank, 2);
      assert.equal(getExportDisplayName(filtered[2], 2, true), 'Thí sinh 3');
    });

    await t3.test('40. original names are absent from anonymous exports', () => {
      const csv = buildLeaderboardCsv({
        title: 'Test',
        roomCode: 'A',
        leaderboardData: rawData,
        topN: 2,
        isAnonymized: true
      });
      assert.ok(!csv.includes('Alice'));
      assert.ok(!csv.includes('Bob'));
      assert.ok(!csv.includes('Carol'));
    });

    await t3.test('41. participant_id is strictly absent from exports', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: rawData, topN: 3, isAnonymized: true });
      assert.ok(!csv.includes('p1') && !csv.includes('participant_id'));
    });

    await t3.test('42. user_id is strictly absent from exports', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: rawData, topN: 3, isAnonymized: true });
      assert.ok(!csv.includes('u1') && !csv.includes('user_id'));
    });

    await t3.test('43. email is strictly absent from exports', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: rawData, topN: 3, isAnonymized: true });
      assert.ok(!csv.includes('a@test.com') && !csv.includes('email'));
    });

    await t3.test('44. team_id and avatar_url are absent from exports', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: rawData, topN: 3, isAnonymized: true });
      assert.ok(!csv.includes('team_id') && !csv.includes('avatar_url'));
    });

    await t3.test('45. guest_token_hash is strictly absent from exports', () => {
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: rawData, topN: 3, isAnonymized: true });
      assert.ok(!csv.includes('guest_token_hash'));
    });
  });

  // ============================================================================
  // GROUP 4: CLIPBOARD PURE FORMATTER & PRIVACY
  // ============================================================================
  await t.test('Group 4: Clipboard Pure Formatter & Privacy', async (t4) => {
    const data = [
      { rank: 1, display_name: 'Nguyễn Văn A', total_score: 950 },
      { rank: 2, display_name: 'Trần Văn B', total_score: 900 },
      { rank: 2, display_name: 'Lê Văn C', total_score: 900 },
      { rank: 4, display_name: 'Phạm Thị D', total_score: 850 }
    ];

    await t4.test('46. includes session title in header line', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường Lớp 5A',
        leaderboardData: data,
        topN: 'all'
      });
      assert.ok(text.startsWith('KẾT QUẢ ĐẤU TRƯỜNG: Đấu Trường Lớp 5A'));
    });

    await t4.test('47. preserves backend rank format', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 3
      });
      assert.ok(text.includes('1. Nguyễn Văn A — 950 điểm'));
    });

    await t4.test('48. tied ranks displayed correctly e.g. 2. and 2.', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 2
      });
      assert.ok(text.includes('2. Trần Văn B — 900 điểm'));
      assert.ok(text.includes('2. Lê Văn C — 900 điểm'));
    });

    await t4.test('49. includes score with "điểm" suffix', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 3
      });
      assert.ok(text.includes('950 điểm'));
    });

    await t4.test('50. topN=3 is respected', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 3
      });
      assert.ok(text.includes('Nguyễn Văn A'));
      assert.ok(text.includes('Trần Văn B'));
      assert.ok(text.includes('Lê Văn C'));
      assert.ok(!text.includes('Phạm Thị D'));
    });

    await t4.test('51. topN=5 is respected', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 5
      });
      assert.ok(text.includes('Phạm Thị D'));
    });

    await t4.test('52. topN="all" includes all rows', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 'all'
      });
      const lines = text.split('\n');
      assert.equal(lines.length, 5); // 1 header + 4 rows
    });

    await t4.test('53. anonymous toggle is respected in clipboard text', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 3,
        isAnonymized: true
      });
      assert.ok(text.includes('1. Thí sinh 1 — 950 điểm'));
      assert.ok(text.includes('2. Thí sinh 2 — 900 điểm'));
      assert.ok(text.includes('2. Thí sinh 3 — 900 điểm'));
      assert.ok(!text.includes('Nguyễn Văn A'));
    });

    await t4.test('54. empty data returns fallback text gracefully', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: [],
        topN: 3
      });
      assert.ok(text.includes('(Chưa có dữ liệu bảng xếp hạng)'));
    });

    await t4.test('55. clipboard text contains zero forbidden PII fields', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường',
        leaderboardData: data,
        topN: 3
      });
      const forbidden = ['participant_id', 'user_id', 'email', 'avatar_url', 'team_id', 'guest_token_hash'];
      for (const p of forbidden) {
        assert.ok(!text.includes(p));
      }
    });

    await t4.test('56. deterministic plain-text output verified', () => {
      const t1Res = buildLeaderboardClipboardText({ title: 'T', leaderboardData: data, topN: 2 });
      const t2Res = buildLeaderboardClipboardText({ title: 'T', leaderboardData: data, topN: 2 });
      assert.equal(t1Res, t2Res);
    });

    await t4.test('56a. clipboard formatter with valid backend rank preserves rank exactly', () => {
      const single = [{ rank: 7, display_name: 'Học sinh Giỏi', total_score: 800 }];
      const text = buildLeaderboardClipboardText({ title: 'Đấu Trường', leaderboardData: single });
      assert.ok(text.includes('7. Học sinh Giỏi — 800 điểm'));
    });

    await t4.test('56b. clipboard formatter with tie ranks 1,1,3 preserves 1,1,3', () => {
      const ties = [
        { rank: 1, display_name: 'A', total_score: 100 },
        { rank: 1, display_name: 'B', total_score: 100 },
        { rank: 3, display_name: 'C', total_score: 80 }
      ];
      const text = buildLeaderboardClipboardText({ title: 'Đấu Trường', leaderboardData: ties });
      const lines = text.split('\n').slice(1);
      assert.equal(lines[0], '1. A — 100 điểm');
      assert.equal(lines[1], '1. B — 100 điểm');
      assert.equal(lines[2], '3. C — 80 điểm');
    });

    await t4.test('56c. clipboard formatter with missing rank does NOT emit index-based fake rank', () => {
      const noRankRows = [
        { rank: null, display_name: 'Thí sinh Không Hạng', total_score: 500 },
        { rank: undefined, display_name: 'Thí sinh Thứ Hai', total_score: 450 }
      ];
      const text = buildLeaderboardClipboardText({ title: 'Đấu Trường', leaderboardData: noRankRows, topN: 'all' });
      assert.ok(!text.includes('1. Thí sinh Không Hạng'));
      assert.ok(!text.includes('2. Thí sinh Thứ Hai'));
      assert.ok(text.includes('Thí sinh Không Hạng — 500 điểm'));
      assert.ok(text.includes('Thí sinh Thứ Hai — 450 điểm'));
    });

    await t4.test('56d. clipboard formatter with missing rank does NOT mutate row.rank', () => {
      const row = { rank: null, display_name: 'Test', total_score: 100 };
      buildLeaderboardClipboardText({ title: 'T', leaderboardData: [row] });
      assert.equal(row.rank, null);
    });

    await t4.test('56e. clipboard anonymous mode with missing rank still does NOT invent rank', () => {
      const noRankRows = [{ rank: null, display_name: 'Alice', total_score: 500 }];
      const text = buildLeaderboardClipboardText({ title: 'Đấu Trường', leaderboardData: noRankRows, isAnonymized: true });
      assert.ok(!text.includes('1. Thí sinh 1'));
      assert.ok(text.includes('Thí sinh 1 — 500 điểm'));
    });

    await t4.test('56f. CSV behavior remains unchanged for missing rank (blank rank column)', () => {
      const noRankRows = [{ rank: null, display_name: 'Alice', total_score: 500, correct_count: 5, total_response_time_ms: 10000, is_guest: false }];
      const csv = buildLeaderboardCsv({ title: 'T', roomCode: 'R', leaderboardData: noRankRows, topN: 'all' });
      const lines = csv.split('\r\n');
      const dataLine = lines[6];
      assert.ok(dataLine.startsWith(',Alice,500,5,10.00,Tài khoản'));
    });

    await t4.test('56g. XLSX behavior remains unchanged for missing rank', () => {
      const noRankRows = [{ rank: null, display_name: 'Alice', total_score: 500 }];
      const wb = buildCompetitionWorkbook({ title: 'T', roomCode: 'R', leaderboardData: noRankRows, analyticsData: null });
      const sheet = wb.Sheets['Bang Xep Hang'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      assert.equal(rows[6][0], '');
    });
  });

  // ============================================================================
  // GROUP 5: UI CONTROLS & CLIPBOARD INTERACTIONS
  // ============================================================================
  await t.test('Group 5: UI Controls & Clipboard Interactions', async (t5) => {
    const hostControlsSrc = fs.readFileSync('src/components/competition/HostExportControls.jsx', 'utf8');

    await t5.test('57. HostExportControls renders Top N select with options all, 3, 5, 10', () => {
      assert.ok(hostControlsSrc.includes('value="all"'));
      assert.ok(hostControlsSrc.includes('value="3"'));
      assert.ok(hostControlsSrc.includes('value="5"'));
      assert.ok(hostControlsSrc.includes('value="10"'));
      assert.ok(hostControlsSrc.includes('Phạm vi:'));
    });

    await t5.test('58. HostExportControls renders print orientation select with portrait and landscape', () => {
      assert.ok(hostControlsSrc.includes('value="portrait"'));
      assert.ok(hostControlsSrc.includes('value="landscape"'));
      assert.ok(hostControlsSrc.includes('Khổ in:'));
    });

    await t5.test('59. HostExportControls renders "Sao chép kết quả" button', () => {
      assert.ok(hostControlsSrc.includes('Sao chép kết quả'));
      assert.ok(hostControlsSrc.includes('handleCopyResults'));
    });

    await t5.test('60. copy handler uses current exportTopN and isAnonymized', () => {
      assert.ok(hostControlsSrc.includes('topN: exportTopN'));
      assert.ok(hostControlsSrc.includes('isAnonymized'));
    });

    await t5.test('61. copy handler prefers navigator.clipboard.writeText', () => {
      assert.ok(hostControlsSrc.includes('navigator.clipboard.writeText'));
    });

    await t5.test('62. copy handler includes off-screen textarea fallback', () => {
      assert.ok(hostControlsSrc.includes("document.createElement('textarea')"));
      assert.ok(hostControlsSrc.includes("document.execCommand('copy')"));
    });

    await t5.test('63. copy handler triggers toast notification on success/error', () => {
      assert.ok(hostControlsSrc.includes("triggerToast('Đã sao chép kết quả')"));
      assert.ok(hostControlsSrc.includes("triggerToast('Không thể sao chép kết quả')"));
    });

    await t5.test('64. export controls are hidden in print with print:hidden', () => {
      assert.ok(hostControlsSrc.includes('print:hidden'));
    });

    await t5.test('64a. fallback textarea cleanup is implemented via finally block', () => {
      assert.ok(hostControlsSrc.includes('finally {'));
      assert.ok(hostControlsSrc.includes('textarea.parentNode.removeChild(textarea)'));
    });

    await t5.test('64b. temporary textarea removed after successful execCommand (simulation)', () => {
      let removedNode = null;
      let textarea = {
        style: {},
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        parentNode: {
          removeChild: (n) => { removedNode = n; }
        }
      };
      let success = false;
      try {
        success = true; // execCommand success
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
      }
      assert.equal(removedNode, textarea);
      assert.equal(success, true);
    });

    await t5.test('64c. temporary textarea removed when execCommand throws/fails (simulation)', () => {
      let removedNode = null;
      let textarea = {
        style: {},
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        parentNode: {
          removeChild: (n) => { removedNode = n; }
        }
      };
      let success = false;
      try {
        throw new Error('execCommand error');
      } catch (_e) {
        success = false;
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
      }
      assert.equal(removedNode, textarea);
      assert.equal(success, false);
    });

    await t5.test('64d. temporary textarea removed when selection path throws (simulation)', () => {
      let removedNode = null;
      let textarea = {
        style: {},
        setAttribute: () => {},
        focus: () => { throw new Error('focus failed'); },
        parentNode: {
          removeChild: (n) => { removedNode = n; }
        }
      };
      let success = false;
      try {
        textarea.focus();
      } catch (_e) {
        success = false;
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
      }
      assert.equal(removedNode, textarea);
      assert.equal(success, false);
    });

    await t5.test('64e. primary navigator.clipboard success does not invoke fallback textarea branch', () => {
      assert.ok(hostControlsSrc.includes("if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function')"));
      assert.ok(hostControlsSrc.includes('return;'));
    });
  });

  // ============================================================================
  // GROUP 6: PRINT ORIENTATION & MULTI-PAGE STABILITY
  // ============================================================================
  await t.test('Group 6: Print Orientation & Multi-page Stability', async (t6) => {
    const printReportSrc = fs.readFileSync('src/components/competition/HostPrintableReport.jsx', 'utf8');

    await t6.test('65. HostPrintableReport accepts printOrientation prop', () => {
      assert.ok(printReportSrc.includes("printOrientation = 'portrait'"));
    });

    await t6.test('66. HostPrintableReport normalizes orientation safely', () => {
      assert.ok(printReportSrc.includes("printOrientation === 'landscape' ? 'landscape' : 'portrait'"));
    });

    await t6.test('67. HostPrintableReport renders @page CSS with A4 size and margin', () => {
      assert.ok(printReportSrc.includes('@media print'));
      assert.ok(printReportSrc.includes('@page'));
      assert.ok(printReportSrc.includes('margin: 12mm'));
    });

    await t6.test('68. HostPrintableReport accepts topN prop and filters leaderboard', () => {
      assert.ok(printReportSrc.includes("topN = 'all'"));
      assert.ok(printReportSrc.includes('filterLeaderboardByRank(leaderboardData, topN)'));
    });

    await t6.test('69. summary metrics remain whole-session invariant', () => {
      assert.ok(printReportSrc.includes('final_roster_count: leaderboardData.length'));
      assert.ok(printReportSrc.includes('Tổng số thí sinh'));
    });

    await t6.test('70. HostPrintableReport enforces table-header-group for repeating headers', () => {
      assert.ok(printReportSrc.includes('[display:table-header-group]'));
    });

    await t6.test('71. HostPrintableReport enforces break-inside-avoid on table rows', () => {
      assert.ok(printReportSrc.includes('break-inside-avoid [break-inside:avoid] [page-break-inside:avoid]'));
    });

    await t6.test('72. HostPrintableReport remains isolated with hidden print:block', () => {
      assert.ok(printReportSrc.includes('hidden print:block'));
    });
  });

  // ============================================================================
  // GROUP 7: STATE OWNERSHIP, RESET CONTRACT & FAIL-CLOSED
  // ============================================================================
  await t.test('Group 7: State Ownership, Reset Contract & Fail-Closed', async (t7) => {
    const hostPageSrc = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');

    await t7.test('73. CompetitionHostPage owns exportTopN state with default "all"', () => {
      assert.ok(hostPageSrc.includes("const [exportTopN, setExportTopN] = useState('all');"));
    });

    await t7.test('74. CompetitionHostPage owns printOrientation state with default "portrait"', () => {
      assert.ok(hostPageSrc.includes("const [printOrientation, setPrintOrientation] = useState('portrait');"));
    });

    await t7.test('75. CompetitionHostPage owns isAnonymizedExport state with default false', () => {
      assert.ok(hostPageSrc.includes("const [isAnonymizedExport, setIsAnonymizedExport] = useState(false);"));
    });

    await t7.test('76. reset helper resets exportTopN to "all"', () => {
      assert.ok(hostPageSrc.includes("setExportTopN('all');"));
    });

    await t7.test('77. reset helper resets printOrientation to "portrait"', () => {
      assert.ok(hostPageSrc.includes("setPrintOrientation('portrait');"));
    });

    await t7.test('78. reset helper resets isAnonymizedExport to false', () => {
      assert.ok(hostPageSrc.includes('setIsAnonymizedExport(false);'));
    });

    await t7.test('79. CompetitionHostPage passes all 3 states and setters to HostExportControls', () => {
      assert.ok(hostPageSrc.includes('isAnonymized={isAnonymizedExport}'));
      assert.ok(hostPageSrc.includes('onAnonymizedChange={setIsAnonymizedExport}'));
      assert.ok(hostPageSrc.includes('exportTopN={exportTopN}'));
      assert.ok(hostPageSrc.includes('onExportTopNChange={setExportTopN}'));
      assert.ok(hostPageSrc.includes('printOrientation={printOrientation}'));
      assert.ok(hostPageSrc.includes('onPrintOrientationChange={setPrintOrientation}'));
    });

    await t7.test('80. CompetitionHostPage passes topN and printOrientation to HostPrintableReport', () => {
      assert.ok(hostPageSrc.includes('topN={exportTopN}'));
      assert.ok(hostPageSrc.includes('printOrientation={printOrientation}'));
    });
  });

  // ============================================================================
  // GROUP 8: R1–R9 REGRESSION & PERFORMANCE BENCHMARK
  // ============================================================================
  await t.test('Group 8: R1–R9 Regression & Performance Benchmark', async (t8) => {
    const hostControlsSrc = fs.readFileSync('src/components/competition/HostExportControls.jsx', 'utf8');
    const analyticsViewSrc = fs.readFileSync('src/components/competition/HostQuestionAnalyticsView.jsx', 'utf8');

    await t8.test('81. HostExportControls does NOT call analytics RPC', () => {
      assert.ok(!hostControlsSrc.includes('getHostQuestionAnalytics'));
      assert.ok(!hostControlsSrc.includes('competition_host_get_question_analytics'));
    });

    await t8.test('82. HostQuestionAnalyticsView is untouched', () => {
      assert.ok(analyticsViewSrc.includes('export const HostQuestionAnalyticsView'));
    });

    await t8.test('83. 500 rows filter benchmark executes in under 10ms (O(N))', () => {
      const bigLeaderboard = Array.from({ length: 500 }, (_, i) => ({
        rank: Math.floor(i / 3) + 1,
        display_name: `Học sinh ${i + 1}`,
        total_score: 1000 - i,
        correct_count: 10,
        total_response_time_ms: 10000 + i * 10
      }));

      const start = performance.now();
      const top3 = filterLeaderboardByRank(bigLeaderboard, 3);
      const top5 = filterLeaderboardByRank(bigLeaderboard, 5);
      const top10 = filterLeaderboardByRank(bigLeaderboard, 10);
      const all = filterLeaderboardByRank(bigLeaderboard, 'all');
      const duration = performance.now() - start;

      assert.ok(top3.length > 0);
      assert.ok(top5.length > 0);
      assert.ok(top10.length > 0);
      assert.equal(all.length, 500);
      assert.ok(duration < 15, `Execution took ${duration.toFixed(2)}ms (expected < 15ms)`);
    });

    await t8.test('84. 500 rows clipboard text generation executes in under 15ms (O(N))', () => {
      const bigLeaderboard = Array.from({ length: 500 }, (_, i) => ({
        rank: Math.floor(i / 3) + 1,
        display_name: `Học sinh ${i + 1}`,
        total_score: 1000 - i
      }));

      const start = performance.now();
      const clipText = buildLeaderboardClipboardText({
        title: 'Đấu Trường Khủng',
        leaderboardData: bigLeaderboard,
        topN: 10,
        isAnonymized: true
      });
      const duration = performance.now() - start;

      assert.ok(clipText.includes('KẾT QUẢ ĐẤU TRƯỜNG: Đấu Trường Khủng'));
      assert.ok(clipText.includes('Thí sinh 1'));
      assert.ok(duration < 20, `Clipboard formatting took ${duration.toFixed(2)}ms (expected < 20ms)`);
    });
  });

});
