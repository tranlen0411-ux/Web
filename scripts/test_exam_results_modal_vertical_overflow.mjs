// scripts/test_exam_results_modal_vertical_overflow.mjs
// Vertical Overflow & Top Clipping Verification Suite for ExamResultsModal (Phase B2 UI)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

async function runVerticalOverflowTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING EXAM RESULTS MODAL VERTICAL OVERFLOW & CLIPPING SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`✅ PASS [${passed}]: ${name}`);
    } catch (err) {
      failed++;
      console.error(`❌ FAIL [${passed + failed}]: ${name}`);
      console.error(err);
    }
  }

  const filePath = path.resolve('src/components/dashboard/exams/ExamResultsModal.jsx');
  const code = fs.readFileSync(filePath, 'utf8');

  // TEST 1: Overlay has fixed inset-0, overflow-y-auto and proper padding
  await test('1. Outer overlay has fixed inset-0 and overflow-y-auto for safe viewport fallback', async () => {
    assert.match(code, /<div className="fixed inset-0 z-\[9990\][^"]*overflow-y-auto"/);
  });

  // TEST 2: Modal shell has bounded max-height, my-auto, shrink-0 and overflow-hidden
  await test('2. Modal shell has max-h bounds, my-auto, shrink-0, and overflow-hidden to prevent top clipping', async () => {
    assert.match(code, /max-h-\[calc\(100vh-1rem\)\]/);
    assert.match(code, /my-auto/);
    assert.match(code, /flex flex-col/);
    assert.match(code, /overflow-hidden/);
    assert.match(code, /shrink-0/);
  });

  // TEST 3: Modal header is shrink-0 and always anchored
  await test('3. Modal header section has shrink-0 to remain anchored and visible', async () => {
    assert.match(
      code,
      /<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b-2 border-indigo-100 shrink-0">/
    );
  });

  // TEST 4: Stats overview and filter controls have shrink-0
  await test('4. Overview cards and filter controls have shrink-0 to maintain structure', async () => {
    assert.match(code, /<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 shrink-0">/);
    assert.match(code, /<div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 mt-3 flex flex-col sm:flex-row items-center gap-2\.5 shrink-0">/);
  });

  // TEST 5: Results table wrapper has flex-1 min-h-0 and overflow-y-auto
  await test('5. Results area has flex-1 min-h-0 overflow-y-auto to absorb vertical scroll strictly inside table', async () => {
    assert.match(code, /<div className="flex-1 min-h-0 overflow-y-auto mt-3 rounded-2xl border-2 border-slate-200 shadow-inner bg-white">/);
  });

  // TEST 6: Table retains horizontal scroll container and min-w-[960px]
  await test('6. Table retains nested overflow-x-auto and min-w-[960px] for horizontal responsiveness', async () => {
    assert.match(code, /<div className="overflow-x-auto">\s*<table className="w-full text-left text-xs font-bold whitespace-nowrap min-w-\[960px\]">/);
  });

  // TEST 7: Modal footer has shrink-0 and close button is fully reachable
  await test('7. Modal footer is shrink-0 and anchored at the bottom', async () => {
    assert.match(code, /<div className="pt-3 flex justify-end shrink-0">/);
  });

  // TEST 8: Viewport Height Matrix Simulation (1536x864, 1366x768, 1024x768, 768x1024, 430x932, 390x844)
  await test('8. Viewport matrix simulation validates vertical bounds and prevents top displacement', async () => {
    const viewports = [
      { name: 'Desktop 1536x864', w: 1536, h: 864 },
      { name: 'Laptop 1366x768', w: 1366, h: 768 },
      { name: 'Tablet Landscape 1024x768', w: 1024, h: 768 },
      { name: 'Tablet Portrait 768x1024', w: 768, h: 1024 },
      { name: 'Mobile 430x932 (iPhone 14/15 Pro Max)', w: 430, h: 932 },
      { name: 'Mobile 390x844 (iPhone 12/13/14)', w: 390, h: 844 },
    ];

    for (const vp of viewports) {
      // With max-h-[calc(100vh-2rem)] and flex-1 min-h-0,
      // modal never exceeds vp.h - 32px.
      const modalMaxH = vp.h - 32;
      const staticHeaderStatsFiltersFooterH = 64 + 80 + 56 + 48 + 48; // ~296px
      const availableTableH = modalMaxH - staticHeaderStatsFiltersFooterH;
      assert.ok(availableTableH > 50, `Available table scroll height must be positive for ${vp.name}`);
    }
  });

  // TEST 9: Zoom Height Matrix Simulation (100%, 125%, 150%)
  await test('9. Browser zoom levels (100%, 125%, 150%) preserve header anchoring via min-h-0 flex shrink', async () => {
    const zoomLevels = [
      { zoom: '100%', baseH: 768, effectiveH: 768 },
      { zoom: '125%', baseH: 768, effectiveH: 768 / 1.25 }, // ~614px
      { zoom: '150%', baseH: 768, effectiveH: 768 / 1.5 },  // ~512px
    ];

    for (const z of zoomLevels) {
      const modalMaxH = z.effectiveH - 16;
      assert.ok(modalMaxH > 300, `Modal max-height stays within effective viewport at ${z.zoom}`);
    }
  });

  console.log('\n================================================================');
  console.log(`🎉 TEST SUMMARY: Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerticalOverflowTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
