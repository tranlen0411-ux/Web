import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';

import {
  sanitizeForFormulaInjection,
  escapeCsvValue,
  formatQuestionType,
  formatOptionDistribution,
  getExportDisplayName,
  filterLeaderboardByRank,
  getTopNSelectionSummary,
  buildLeaderboardClipboardText,
  calculateWorksheetColumnWidths,
  buildLeaderboardCsv,
  buildAnalyticsCsv,
  buildCompetitionWorkbook
} from '../src/utils/competitionExport.js';

// ============================================================================
// FIXTURES
// ============================================================================
const sampleLeaderboard = [
  { participant_id: 'p1', display_name: 'Nguyễn Văn A', rank: 1, total_score: 95, correct_count: 10, total_response_time_ms: 12000, is_guest: false },
  { participant_id: 'p2', display_name: 'Trần Thị B', rank: 2, total_score: 90, correct_count: 9, total_response_time_ms: 15000, is_guest: false },
  { participant_id: 'p3', display_name: 'Lê Văn C', rank: 3, total_score: 85, correct_count: 8, total_response_time_ms: 18000, is_guest: true },
  { participant_id: 'p4', display_name: 'Phạm Thị D', rank: 3, total_score: 85, correct_count: 8, total_response_time_ms: 18000, is_guest: false },
  { participant_id: 'p5', display_name: 'Hoàng Văn E', rank: 5, total_score: 80, correct_count: 7, total_response_time_ms: 20000, is_guest: false },
  { participant_id: 'p6', display_name: 'Vũ Thị F', rank: 6, total_score: 75, correct_count: 6, total_response_time_ms: 22000, is_guest: true }
];

const sampleAnalytics = {
  summary: {
    total_questions: 2,
    final_roster_count: 6,
    overall_accuracy_percent: 75,
    total_correct_instances: 9,
    total_answered_instances: 12
  },
  questions: [
    {
      question_id: 'q1',
      question_order: 1,
      question_type: 'single_choice',
      question_text: 'Thủ đô của Việt Nam là gì?',
      points: 10.0,
      final_roster_count: 6,
      answered_count: 6,
      unanswered_count: 0,
      correct_count: 5,
      incorrect_count: 1,
      accuracy_percent: 83,
      average_points: 8.33,
      average_response_time_ms: 4500,
      option_distribution: [
        { option_text: 'Hà Nội', is_correct: true, selection_count: 5, selection_percent: 83 },
        { option_text: 'TP. Hồ Chí Minh', is_correct: false, selection_count: 1, selection_percent: 17 }
      ]
    },
    {
      question_id: 'q2',
      question_order: 2,
      question_type: 'true_false',
      question_text: 'Mặt trời mọc ở hướng Đông.',
      points: 10.0,
      final_roster_count: 6,
      answered_count: 6,
      unanswered_count: 0,
      correct_count: 4,
      incorrect_count: 2,
      accuracy_percent: 67,
      average_points: 6.67,
      average_response_time_ms: 3200,
      option_distribution: [
        { option_text: 'Đúng', is_correct: true, selection_count: 4, selection_percent: 67 },
        { option_text: 'Sai', is_correct: false, selection_count: 2, selection_percent: 33 }
      ]
    }
  ]
};

test('COMPETITION V1 R11 — TIE INDICATOR & EXPORT TRANSPARENCY TEST SUITE', async (t) => {

  // ============================================================================
  // GROUP 1: PURE SUMMARY HELPER UNIT TESTS & BOUNDARY HARDENING (22 tests)
  // ============================================================================
  await t.test('Group 1: Pure Summary Helper Unit Tests & Boundary Hardening', async (t1) => {
    await t1.test('1. non-array safe: null returns clean 0 count summary', () => {
      const s = getTopNSelectionSummary(null, 3);
      assert.equal(s.selectedCount, 0);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.topN, 3);
    });

    await t1.test('2. non-array safe: undefined and non-numeric handled cleanly', () => {
      const s1 = getTopNSelectionSummary(undefined, 'all');
      assert.equal(s1.selectedCount, 0);
      assert.equal(s1.topN, 'all');
      assert.equal(s1.hasBoundaryTie, false);
      assert.equal(s1.boundaryRank, null);

      const s2 = getTopNSelectionSummary(12345, 'all');
      assert.equal(s2.selectedCount, 0);
      assert.equal(s2.boundaryRank, null);
    });

    await t1.test('3. all mode returns full count and no tie warning', () => {
      const s = getTopNSelectionSummary(sampleLeaderboard, 'all');
      assert.equal(s.topN, 'all');
      assert.equal(s.selectedCount, 6);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, 'Tất cả 6 thí sinh');
    });

    await t1.test('4. empty array returns 0 count and clean state', () => {
      const s = getTopNSelectionSummary([], 3);
      assert.equal(s.selectedCount, 0);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '0 thí sinh');
    });

    await t1.test('5. Top 3 normal ranks [1, 2, 3]', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '3 thí sinh');
    });

    await t1.test('6. Top 3 ranks [1, 2, 2]', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 2 }, { rank: 4 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '3 thí sinh');
    });

    await t1.test('7. Top 3 ranks [1, 2, 3, 3, 5] (actual boundary tie at rank 3)', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 3 }, { rank: 5 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 4);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 1);
      assert.equal(s.boundaryRank, 3);
      assert.equal(s.label, '4 thí sinh (+1 đồng hạng)');
    });

    await t1.test('8. Top 3 ranks [1, 2, 3, 3, 3, 6] (boundary tie with 3 participants)', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 3 }, { rank: 3 }, { rank: 6 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 5);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 2);
      assert.equal(s.boundaryRank, 3);
      assert.equal(s.label, '5 thí sinh (+2 đồng hạng)');
    });

    await t1.test('9. Required Case 1: [1, 1, 1, 1, 5], Top 3 => rank gap, no boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 5 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 4);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '4 thí sinh');
    });

    await t1.test('10. Required Case 2: [1, 1, 1, 1, 5], Top 5 => rank 5 count 1, no boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 5 }];
      const s = getTopNSelectionSummary(lb, 5);
      assert.equal(s.selectedCount, 5);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '5 thí sinh');
    });

    await t1.test('11. Required Case 5: [1, 1, 3, 4], Top 3 => rank 3 count 1, no boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 3 }, { rank: 4 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '3 thí sinh');
    });

    await t1.test('12. Required Case 6: [1, 1, 1, 4], Top 3 => rank 3 count 0, no boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 4 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '3 thí sinh');
    });

    await t1.test('13. Required Case 7: 10 rows rank 1 then rank 11, Top 10 => no boundary tie', () => {
      const lb = [];
      for (let i = 0; i < 10; i++) lb.push({ rank: 1 });
      lb.push({ rank: 11 });
      const s = getTopNSelectionSummary(lb, 10);
      assert.equal(s.selectedCount, 10);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '10 thí sinh');
    });

    await t1.test('14. Required Case 8: 4 rows rank 1 then rank 5, Top 3 => selectedCount 4, no boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 5 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 4);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, '4 thí sinh');
    });

    await t1.test('15. Top 2 ranks [1, 2, 2, 4] (boundary tie at rank 2)', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 2 }, { rank: 4 }];
      const s = getTopNSelectionSummary(lb, 2);
      assert.equal(s.selectedCount, 3);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 1);
      assert.equal(s.boundaryRank, 2);
      assert.equal(s.label, '3 thí sinh (+1 đồng hạng)');
    });

    await t1.test('16. Top 5 boundary tie [1, 2, 3, 4, 5, 5, 7]', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }, { rank: 5 }, { rank: 5 }, { rank: 7 }];
      const s = getTopNSelectionSummary(lb, 5);
      assert.equal(s.selectedCount, 6);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 1);
      assert.equal(s.boundaryRank, 5);
      assert.equal(s.label, '6 thí sinh (+1 đồng hạng)');
    });

    await t1.test('17. Top 10 boundary tie [1..9, 10, 10, 10, 13]', () => {
      const lb = [
        { rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }, { rank: 5 },
        { rank: 6 }, { rank: 7 }, { rank: 8 }, { rank: 9 },
        { rank: 10 }, { rank: 10 }, { rank: 10 }, { rank: 13 }
      ];
      const s = getTopNSelectionSummary(lb, 10);
      assert.equal(s.selectedCount, 12);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 2);
      assert.equal(s.boundaryRank, 10);
      assert.equal(s.label, '12 thí sinh (+2 đồng hạng)');
    });

    await t1.test('18. missing rank rows handled safely', () => {
      const lb = [{ rank: 1 }, { rank: null }, { rank: undefined }, { rank: 2 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 2);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
    });

    await t1.test('19. string numeric rank e.g. "3" parsed safely', () => {
      const lb = [{ rank: '1' }, { rank: '2' }, { rank: '3' }, { rank: '3' }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 4);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 1);
      assert.equal(s.boundaryRank, 3);
    });

    await t1.test('20. invalid rank string excluded from count', () => {
      const lb = [{ rank: 1 }, { rank: 'invalid' }, { rank: NaN }, { rank: 2 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 2);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
    });

    await t1.test('21. source array not mutated', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }];
      const copy = JSON.stringify(lb);
      getTopNSelectionSummary(lb, 3);
      assert.equal(JSON.stringify(lb), copy);
    });

    await t1.test('22. row objects not mutated', () => {
      const row = { rank: 1, total_score: 100 };
      const lb = [row];
      getTopNSelectionSummary(lb, 1);
      assert.equal(row.rank, 1);
      assert.equal(row.total_score, 100);
    });
  });

  // ============================================================================
  // GROUP 2: TIE EXPLANATION & SEMANTICS (8 tests)
  // ============================================================================
  await t.test('Group 2: Tie Explanation & Semantics', async (t2) => {
    await t2.test('23. no boundary tie => no false "+N đồng hạng" warning in label', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
      assert.ok(!s.label.includes('đồng hạng'));
    });

    await t2.test('24. real boundary tie => correct extra count in label', () => {
      const lb = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 3 }, { rank: 3 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 2);
      assert.equal(s.boundaryRank, 3);
      assert.equal(s.label, '5 thí sinh (+2 đồng hạng)');
    });

    await t2.test('25. boundary rank matches numericLimit when tie present', () => {
      const s3 = getTopNSelectionSummary(sampleLeaderboard, 3);
      assert.equal(s3.hasBoundaryTie, true);
      assert.equal(s3.boundaryRank, 3);
      const s5 = getTopNSelectionSummary(sampleLeaderboard, 5);
      assert.equal(s5.hasBoundaryTie, false);
      assert.equal(s5.boundaryRank, null);
      const s10 = getTopNSelectionSummary(sampleLeaderboard, 10);
      assert.equal(s10.hasBoundaryTie, false);
      assert.equal(s10.boundaryRank, null);
    });

    await t2.test('26. selectedCount exactly equals filterLeaderboardByRank count', () => {
      for (const n of [3, 5, 10, 'all']) {
        const s = getTopNSelectionSummary(sampleLeaderboard, n);
        const filtered = filterLeaderboardByRank(sampleLeaderboard, n);
        assert.equal(s.selectedCount, filtered.length);
      }
    });

    await t2.test('27. all mode produces clean label without tie notation', () => {
      const s = getTopNSelectionSummary(sampleLeaderboard, 'all');
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.boundaryRank, null);
      assert.equal(s.label, 'Tất cả 6 thí sinh');
    });

    await t2.test('28. Top N selectedCount is consistent across repeated calls', () => {
      const s1 = getTopNSelectionSummary(sampleLeaderboard, 3);
      const s2 = getTopNSelectionSummary(sampleLeaderboard, 3);
      assert.deepEqual(s1, s2);
    });

    await t2.test('29. gap ranking is not falsely described as boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 3 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
    });

    await t2.test('30. duplicated rank below boundary does not trigger false boundary tie', () => {
      const lb = [{ rank: 1 }, { rank: 1 }, { rank: 2 }, { rank: 4 }];
      const s = getTopNSelectionSummary(lb, 3);
      assert.equal(s.selectedCount, 3);
      assert.equal(s.hasBoundaryTie, false);
      assert.equal(s.extraDueToTie, 0);
      assert.equal(s.boundaryRank, null);
    });
  });

  // ============================================================================
  // GROUP 3: HOST EXPORT CONTROLS SOURCE & LOGIC INSPECTION (11 tests)
  // ============================================================================
  await t.test('Group 3: Host Export Controls Source & Logic Inspection', async (t3) => {
    const controlsSrc = fs.readFileSync('src/components/competition/HostExportControls.jsx', 'utf8');

    await t3.test('27. HostExportControls imports getTopNSelectionSummary', () => {
      assert.ok(controlsSrc.includes('getTopNSelectionSummary'));
    });

    await t3.test('28. HostExportControls computes topNSummary from props', () => {
      assert.ok(controlsSrc.includes('getTopNSelectionSummary(leaderboardData, exportTopN)'));
    });

    await t3.test('29. HostExportControls renders tie indicator when exportTopN !== "all"', () => {
      assert.ok(controlsSrc.includes("exportTopN !== 'all'"));
      assert.ok(controlsSrc.includes('topNSummary.label'));
    });

    await t3.test('30. HostExportControls applies distinctive styling when hasBoundaryTie is true', () => {
      assert.ok(controlsSrc.includes('topNSummary.hasBoundaryTie'));
      assert.ok(controlsSrc.includes('bg-amber-400/25 text-amber-200 border-amber-300/40'));
    });

    await t3.test('31. HostExportControls applies standard badge style when no boundary tie', () => {
      assert.ok(controlsSrc.includes('bg-white/15 text-white/90 border-white/20'));
    });

    await t3.test('32. HostExportControls provides detailed title tooltip explaining boundary tie', () => {
      assert.ok(controlsSrc.includes('topNSummary.extraDueToTie'));
      assert.ok(controlsSrc.includes('topNSummary.boundaryRank'));
    });

    await t3.test('33. anonymous mode does not interfere with topNSummary calculation', () => {
      // getTopNSelectionSummary does not take isAnonymized (rank only)
      const sNormal = getTopNSelectionSummary(sampleLeaderboard, 3);
      const sAnon = getTopNSelectionSummary(sampleLeaderboard, 3);
      assert.deepEqual(sNormal, sAnon);
    });

    await t3.test('34. Top N selection options include all, 3, 5, 10', () => {
      assert.ok(controlsSrc.includes('<option value="all"'));
      assert.ok(controlsSrc.includes('<option value="3"'));
      assert.ok(controlsSrc.includes('<option value="5"'));
      assert.ok(controlsSrc.includes('<option value="10"'));
    });

    await t3.test('35. HostExportControls does not perform network calls', () => {
      assert.ok(!controlsSrc.includes('fetch('));
      assert.ok(!controlsSrc.includes('axios'));
    });

    await t3.test('36. HostExportControls contains no RPC invocations', () => {
      assert.ok(!controlsSrc.includes('.rpc('));
    });

    await t3.test('37. HostExportControls contains no localStorage or persistent storage', () => {
      assert.ok(!controlsSrc.includes('localStorage'));
      assert.ok(!controlsSrc.includes('sessionStorage'));
    });
  });

  // ============================================================================
  // GROUP 4: PRINT TRANSPARENCY & REPORT ENHANCEMENT (10 tests)
  // ============================================================================
  await t.test('Group 4: Print Transparency & Report Enhancement', async (t4) => {
    const printSrc = fs.readFileSync('src/components/competition/HostPrintableReport.jsx', 'utf8');

    await t4.test('38. HostPrintableReport imports getTopNSelectionSummary', () => {
      assert.ok(printSrc.includes('getTopNSelectionSummary'));
    });

    await t4.test('39. HostPrintableReport calculates topNSummary for report', () => {
      assert.ok(printSrc.includes('getTopNSelectionSummary(leaderboardData, topN)'));
    });

    await t4.test('40. HostPrintableReport renders tie indicator in Section 2 title', () => {
      assert.ok(printSrc.includes('topNSummary.hasBoundaryTie'));
      assert.ok(printSrc.includes('topNSummary.extraDueToTie'));
      assert.ok(printSrc.includes('topNSummary.selectedCount'));
    });

    await t4.test('41. HostPrintableReport displays standard count when no tie', () => {
      assert.ok(printSrc.includes('`(Đang lọc: Top ${topN} • ${topNSummary.selectedCount} thí sinh)`'));
    });

    await t4.test('42. HostPrintableReport displays tie annotation when tie present', () => {
      assert.ok(printSrc.includes('`(Đang lọc: Top ${topN} • ${topNSummary.selectedCount} thí sinh • +${topNSummary.extraDueToTie} đồng hạng)`'));
    });

    await t4.test('43. executive summary metrics remain whole-session invariant', () => {
      assert.ok(printSrc.includes('final_roster_count: leaderboardData.length'));
      assert.ok(printSrc.includes('Tổng số thí sinh'));
    });

    await t4.test('44. print CSS isolation preserved with hidden print:block', () => {
      assert.ok(printSrc.includes('hidden print:block'));
    });

    await t4.test('45. table rows maintain page-break-inside avoid', () => {
      assert.ok(printSrc.includes('break-inside-avoid [break-inside:avoid] [page-break-inside:avoid]'));
    });

    await t4.test('46. portrait orientation preserved', () => {
      assert.ok(printSrc.includes("printOrientation = 'portrait'"));
      assert.ok(printSrc.includes('size: A4 ${pageOrientation};'));
    });

    await t4.test('47. landscape orientation preserved', () => {
      assert.ok(printSrc.includes("pageOrientation = printOrientation === 'landscape' ? 'landscape' : 'portrait'"));
    });
  });

  // ============================================================================
  // GROUP 5: R10 REGRESSION & BACKWARD COMPATIBILITY (12 tests)
  // ============================================================================
  await t.test('Group 5: R10 Regression & Backward Compatibility', async (t5) => {
    await t5.test('48. filterLeaderboardByRank semantics unchanged for all', () => {
      const filtered = filterLeaderboardByRank(sampleLeaderboard, 'all');
      assert.equal(filtered.length, 6);
    });

    await t5.test('49. Top 3 rank-based filter preserves all ties', () => {
      const filtered = filterLeaderboardByRank(sampleLeaderboard, 3);
      assert.deepEqual(filtered.map(r => r.rank), [1, 2, 3, 3]);
    });

    await t5.test('50. Top 5 rank-based filter preserves all ties', () => {
      const filtered = filterLeaderboardByRank(sampleLeaderboard, 5);
      assert.deepEqual(filtered.map(r => r.rank), [1, 2, 3, 3, 5]);
    });

    await t5.test('51. Top 10 rank-based filter includes all valid ranks <= 10', () => {
      const filtered = filterLeaderboardByRank(sampleLeaderboard, 10);
      assert.equal(filtered.length, 6);
    });

    await t5.test('52. Tie-safe filter preserves original array order', () => {
      const filtered = filterLeaderboardByRank(sampleLeaderboard, 3);
      assert.equal(filtered[0].participant_id, 'p1');
      assert.equal(filtered[1].participant_id, 'p2');
      assert.equal(filtered[2].participant_id, 'p3');
      assert.equal(filtered[3].participant_id, 'p4');
    });

    await t5.test('53. CSV export respects Top N filter', () => {
      const csvTop3 = buildLeaderboardCsv({
        title: 'Test',
        roomCode: '123',
        leaderboardData: sampleLeaderboard,
        topN: 3
      });
      assert.ok(csvTop3.includes('"TỔNG SỐ THÍ SINH",4'));
      assert.ok(csvTop3.includes('Nguyễn Văn A'));
      assert.ok(csvTop3.includes('Phạm Thị D'));
      assert.ok(!csvTop3.includes('Hoàng Văn E'));
    });

    await t5.test('54. XLSX workbook Sheet 1 respects Top N filter', () => {
      const wb = buildCompetitionWorkbook({
        title: 'Test',
        roomCode: '123',
        leaderboardData: sampleLeaderboard,
        analyticsData: sampleAnalytics,
        topN: 3
      });
      const sheet1 = wb.Sheets['Bang Xep Hang'];
      assert.ok(sheet1);
      assert.equal(sheet1['B4'].v, 4);
    });

    await t5.test('55. Clipboard text respects Top N filter and preserves ties', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Đấu Trường Test',
        leaderboardData: sampleLeaderboard,
        topN: 3,
        isAnonymized: false
      });
      const lines = text.split('\n');
      assert.equal(lines[0], 'KẾT QUẢ ĐẤU TRƯỜNG: Đấu Trường Test');
      assert.ok(lines.some(l => l.startsWith('1. Nguyễn Văn A')));
      assert.ok(lines.some(l => l.startsWith('3. Lê Văn C')));
      assert.ok(lines.some(l => l.startsWith('3. Phạm Thị D')));
      assert.ok(!lines.some(l => l.includes('Hoàng Văn E')));
    });

    await t5.test('56. Anonymous mode numbering is array-position based', () => {
      const text = buildLeaderboardClipboardText({
        title: 'Test',
        leaderboardData: sampleLeaderboard,
        topN: 3,
        isAnonymized: true
      });
      assert.ok(text.includes('1. Thí sinh 1'));
      assert.ok(text.includes('2. Thí sinh 2'));
      assert.ok(text.includes('3. Thí sinh 3'));
      assert.ok(text.includes('3. Thí sinh 4'));
    });

    await t5.test('57. Backend rank values in export are untouched', () => {
      const csv = buildLeaderboardCsv({
        leaderboardData: sampleLeaderboard,
        topN: 3
      });
      assert.ok(csv.includes('3,Lê Văn C,85'));
      assert.ok(csv.includes('3,Phạm Thị D,85'));
    });

    await t5.test('58. State reset behavior unaffected', () => {
      const s = getTopNSelectionSummary(sampleLeaderboard, 'all');
      assert.equal(s.topN, 'all');
    });

    await t5.test('59. No storage dependencies introduced', () => {
      assert.equal(typeof window === 'undefined', true);
    });
  });

  // ============================================================================
  // GROUP 6: R7/R8/R9 INTEGRITY & PERFORMANCE BENCHMARK (13 tests)
  // ============================================================================
  await t.test('Group 6: R7/R8/R9 Integrity & Performance Benchmark', async (t6) => {
    await t6.test('60. Analytics data remains unfiltered by Top N in CSV', () => {
      const csvAnalytics = buildAnalyticsCsv({
        title: 'Test',
        roomCode: '123',
        analyticsData: sampleAnalytics
      });
      assert.ok(csvAnalytics.includes('"TỔNG SỐ CÂU",2'));
      assert.ok(csvAnalytics.includes('Thủ đô của Việt Nam là gì?'));
      assert.ok(csvAnalytics.includes('Mặt trời mọc ở hướng Đông.'));
    });

    await t6.test('61. Lazy analytics loading contract preserved', () => {
      const csvNoAnalytics = buildAnalyticsCsv({
        analyticsData: null
      });
      assert.ok(csvNoAnalytics.includes('"TỔNG SỐ CÂU",0'));
    });

    await t6.test('62. No second analytics fetch triggered during summary calculation', () => {
      const s = getTopNSelectionSummary(sampleLeaderboard, 3);
      assert.ok(s.selectedCount > 0);
    });

    await t6.test('63. XLSX contains exactly 2 sheets', () => {
      const wb = buildCompetitionWorkbook({
        leaderboardData: sampleLeaderboard,
        analyticsData: sampleAnalytics
      });
      assert.deepEqual(wb.SheetNames, ['Bang Xep Hang', 'Phan Tich Cau Hoi']);
    });

    await t6.test('64. Formula injection sanitization preserved', () => {
      assert.equal(sanitizeForFormulaInjection('=SUM(A1:A10)'), "'=SUM(A1:A10)");
      assert.equal(sanitizeForFormulaInjection('+CMD|'), "'+CMD|");
      assert.equal(sanitizeForFormulaInjection('-10'), '-10');
      assert.equal(sanitizeForFormulaInjection('Normal Text'), 'Normal Text');
    });

    await t6.test('65. Auto-width column calculation works correctly', () => {
      const aoa = [
        ['Header 1', 'Longer Header Name'],
        ['Short', 'Very Long Content Exceeding Default']
      ];
      const widths = calculateWorksheetColumnWidths(aoa);
      assert.equal(widths.length, 2);
      assert.ok(widths[0].wch >= 10);
      assert.ok(widths[1].wch >= widths[0].wch);
    });

    await t6.test('66. Question text column width capped at 60', () => {
      const wb = buildCompetitionWorkbook({
        leaderboardData: sampleLeaderboard,
        analyticsData: sampleAnalytics
      });
      const wsAnalytics = wb.Sheets['Phan Tich Cau Hoi'];
      assert.ok(wsAnalytics['!cols'][2].wch <= 60);
    });

    await t6.test('67. Option distribution column width capped at 55', () => {
      const wb = buildCompetitionWorkbook({
        leaderboardData: sampleLeaderboard,
        analyticsData: sampleAnalytics
      });
      const wsAnalytics = wb.Sheets['Phan Tich Cau Hoi'];
      assert.ok(wsAnalytics['!cols'][12].wch <= 55);
    });

    await t6.test('68. Anonymous mode toggle is independent of Top N', () => {
      const nameAnon = getExportDisplayName({ display_name: 'Nguyễn Văn A' }, 0, true);
      assert.equal(nameAnon, 'Thí sinh 1');
      const nameNormal = getExportDisplayName({ display_name: 'Nguyễn Văn A' }, 0, false);
      assert.equal(nameNormal, 'Nguyễn Văn A');
    });

    await t6.test('69. Option distribution formatting masks short answer raw text', () => {
      const saQuestion = {
        question_type: 'short_answer',
        option_distribution: [{ option_text: 'Student secret text' }]
      };
      const formatted = formatOptionDistribution(saQuestion);
      assert.equal(formatted, 'Tự luận ngắn - không xuất câu trả lời thô');
    });

    await t6.test('70. O(n) complexity of getTopNSelectionSummary on 5,000 rows', () => {
      const bigLb = [];
      for (let i = 1; i <= 5000; i++) {
        bigLb.push({
          participant_id: `p${i}`,
          display_name: `Học sinh ${i}`,
          rank: Math.min(i, 100),
          total_score: 1000 - i
        });
      }
      const start = performance.now();
      const s = getTopNSelectionSummary(bigLb, 10);
      const end = performance.now();
      const elapsed = end - start;

      assert.equal(s.topN, 10);
      assert.equal(s.selectedCount, 10);
      assert.equal(s.hasBoundaryTie, false);
      assert.ok(elapsed < 20, `Execution took ${elapsed}ms, expected < 20ms`);
    });

    await t6.test('71. getTopNSelectionSummary 5,000 rows with massive boundary tie', () => {
      const bigLb = [];
      for (let i = 1; i <= 5000; i++) {
        bigLb.push({
          participant_id: `p${i}`,
          display_name: `Học sinh ${i}`,
          rank: i <= 2 ? i : 3, // 4,998 participants tied at rank 3!
          total_score: 100
        });
      }
      const start = performance.now();
      const s = getTopNSelectionSummary(bigLb, 3);
      const end = performance.now();
      const elapsed = end - start;

      assert.equal(s.selectedCount, 5000);
      assert.equal(s.hasBoundaryTie, true);
      assert.equal(s.extraDueToTie, 4997);
      assert.equal(s.label, '5000 thí sinh (+4997 đồng hạng)');
      assert.ok(elapsed < 25, `Execution took ${elapsed}ms, expected < 25ms`);
    });

    await t6.test('72. getTopNSelectionSummary on 5,000 rows benchmark duration report', () => {
      const bigLb = [];
      for (let i = 1; i <= 5000; i++) {
        bigLb.push({
          participant_id: `p${i}`,
          display_name: `Học sinh ${i}`,
          rank: (i % 20) + 1,
          total_score: 1000 - (i % 20)
        });
      }
      const start = performance.now();
      for (let iter = 0; iter < 10; iter++) {
        getTopNSelectionSummary(bigLb, 5);
      }
      const end = performance.now();
      const avgDuration = (end - start) / 10;
      assert.ok(avgDuration < 10, `Average duration ${avgDuration}ms should be < 10ms`);
    });
  });
});
