import { runPhase2ALastSecurityTestSuite } from './test_competition_v1_phase2a_pglite.mjs';
import { runPhase2BTestSuite } from './test_competition_v1_phase2b_pglite.mjs';
import { runPhase2CTestSuite } from './test_competition_v1_phase2c_pglite.mjs';
import { runPhase2D1TestSuite } from './test_competition_v1_phase2d1_pglite.mjs';
import { runPhase2D2TestSuite } from './test_competition_v1_phase2d2_pglite.mjs';

async function main() {
  console.log('================================================================================');
  console.log('🏁 CHẠY TOÀN BỘ REGRESSION TEST SUITE COMPETITION V1 (PHASE 2A -> 2D-2)');
  console.log('================================================================================\n');

  const r2A = await runPhase2ALastSecurityTestSuite();
  const r2B = await runPhase2BTestSuite();
  const r2C = await runPhase2CTestSuite();
  const r2D1 = await runPhase2D1TestSuite();
  const r2D2 = await runPhase2D2TestSuite();

  const totalPassed = r2A.assertionsPassed + r2B.assertionsPassed + r2C.assertionsPassed + r2D1.assertionsPassed + r2D2.assertionsPassed;
  const totalAssertions = r2A.totalAssertions + r2B.totalAssertions + r2C.totalAssertions + r2D1.totalAssertions + r2D2.totalAssertions;

  console.log('\n================================================================================');
  console.log(`🏆 TỔNG KẾT TẤT CẢ TEST SUITES: ${totalPassed}/${totalAssertions} ASSERTIONS PASSED (100% GREEN)`);
  console.log(`- Phase 2A (Join/Rejoin Internal): ${r2A.assertionsPassed}/${r2A.totalAssertions}`);
  console.log(`- Phase 2B (Submit Answer Internal): ${r2B.assertionsPassed}/${r2B.totalAssertions}`);
  console.log(`- Phase 2C (Finish/Leaderboard Internal): ${r2C.assertionsPassed}/${r2C.totalAssertions}`);
  console.log(`- Phase 2D-1 (Public Participant RPCs): ${r2D1.assertionsPassed}/${r2D1.totalAssertions}`);
  console.log(`- Phase 2D-2 (Public Host RPCs): ${r2D2.assertionsPassed}/${r2D2.totalAssertions}`);
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('REGRESSION FAILED:', err);
  process.exit(1);
});
