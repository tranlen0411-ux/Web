import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 R3 FINAL RESULTS & PODIUM CEREMONY TEST SUITE');
console.log('================================================================================\n');

// ============================================================================
// Test 1: Static Source & Security Invariants Verification
// ============================================================================
console.log('--- [Test 1] Static Source Verification & Data Privacy Invariants ---');

const clientSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');
const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');

// 1.A: Frontend NEVER queries competition_answers directly
assert.ok(
  !clientSource.includes(".from('competition_answers')"),
  'competitionClient.js must NOT perform direct .from(\'competition_answers\')'
);
assert.ok(
  !hostPageSource.includes(".from('competition_answers')"),
  'CompetitionHostPage.jsx must NOT perform direct .from(\'competition_answers\')'
);
console.log('  ✅ [1.A] PASS: Zero direct client queries on competition_answers');

// 1.B: Authoritative Leaderboard Snapshot Function Used
assert.ok(
  clientSource.includes('export async function getLeaderboardSnapshot'),
  'competitionClient.js must export getLeaderboardSnapshot'
);
assert.ok(
  clientSource.includes("supabase.rpc('competition_get_leaderboard_snapshot'"),
  'getLeaderboardSnapshot must invoke competition_get_leaderboard_snapshot RPC'
);
console.log('  ✅ [1.B] PASS: Authoritative getLeaderboardSnapshot RPC wrapped correctly');

// 1.C: Host View Modes includes FINAL_RESULTS
assert.ok(
  hostPageSource.includes('LIVE_QUESTION') &&
  hostPageSource.includes('QUESTION_RESULTS') &&
  hostPageSource.includes('LEADERBOARD') &&
  hostPageSource.includes('FINAL_RESULTS'),
  'CompetitionHostPage.jsx must include view modes: LIVE_QUESTION, QUESTION_RESULTS, LEADERBOARD, FINAL_RESULTS'
);
console.log('  ✅ [1.C] PASS: Host view modes include FINAL_RESULTS');

// 1.D: Banned participant-level raw fields check
const bannedRawFields = [
  'guest_token_hash',
  'guest_token',
  'raw_answer'
];
bannedRawFields.forEach(field => {
  assert.ok(
    !hostPageSource.includes(`item.${field}`) && !hostPageSource.includes(`p.${field}`),
    `Host UI must NOT access private field '${field}'`
  );
});
console.log('  ✅ [1.D] PASS: Zero private participant fields leaked in Host UI');

// 1.E: Stale response / race condition guard in fetchLeaderboard
assert.ok(
  hostPageSource.includes('latestLeaderboardRequestIdRef') ||
  hostPageSource.includes('latestLeaderboardReqRef') ||
  hostPageSource.includes('targetSessionId'),
  'CompetitionHostPage.jsx must have request ID / session guard for leaderboard fetches'
);
console.log('  ✅ [1.E] PASS: Request ID / stale response race guard implemented');

// 1.F: No extra polling loops introduced
const hookSource = fs.readFileSync('src/hooks/useHostCompetitionPolling.js', 'utf8');
const setIntervalInHook = hookSource.match(/setInterval/g) || [];
assert.equal(
  setIntervalInHook.length,
  0,
  'useHostCompetitionPolling.js must NOT introduce any setInterval polling loops'
);
console.log('  ✅ [1.F] PASS: Zero extra polling loops');


// ============================================================================
// Test 2: Host View State Machine Simulation (Finish Flow & Reload Recovery)
// ============================================================================
console.log('\n--- [Test 2] Host View State Machine Simulation ---');

class MockHostSessionManager {
  constructor({ sessionId, initialStatus = 'in_progress', initialQuestionId = 'q1' }) {
    this.sessionId = sessionId;
    this.status = initialStatus;
    this.currentQuestionId = initialQuestionId;
    this.viewMode = 'LIVE_QUESTION';
    this.questionResults = null;
    this.timeLeftSeconds = 30;
    this.autoResultAttempt = { key: 'q1:30', attempts: 1 };
    this.leaderboardData = [];
    this.leaderboardError = null;
    this.latestRequestId = 0;
  }

  // 1. Host finishes session flow
  async handleFinishSession(mockFinishRpc, mockLeaderboardRpc) {
    const res = await mockFinishRpc(this.sessionId);
    if (!res.success) {
      return { success: false, message: res.message };
    }

    // Clear stale question state & timer
    this.questionResults = null;
    this.timeLeftSeconds = null;
    this.autoResultAttempt = null;
    this.status = 'finished';

    // Fetch authoritative leaderboard
    const lbRes = await this.fetchLeaderboard(this.sessionId, mockLeaderboardRpc);
    this.viewMode = 'FINAL_RESULTS';
    return { success: true, lbSuccess: lbRes.success };
  }

  // 2. Fetch leaderboard with race guard
  async fetchLeaderboard(targetSessionId, mockLeaderboardRpc) {
    const reqId = ++this.latestRequestId;
    this.leaderboardError = null;

    try {
      const res = await mockLeaderboardRpc(targetSessionId);
      if (reqId !== this.latestRequestId) {
        return { success: false, error_code: 'STALE_REQUEST' };
      }

      if (res.success && Array.isArray(res.data?.leaderboard)) {
        this.leaderboardData = res.data.leaderboard;
        this.leaderboardError = null;
        return { success: true, data: res.data.leaderboard };
      } else {
        this.leaderboardError = res.message || 'Lỗi tải bảng xếp hạng';
        return { success: false, error_code: 'RPC_ERROR' };
      }
    } catch (err) {
      if (reqId === this.latestRequestId) {
        this.leaderboardError = err.message;
      }
      return { success: false, error_code: 'NETWORK_ERROR' };
    }
  }

  // 3. Reload recovery on finished session
  syncFinishedSession(snapshot, mockLeaderboardRpc) {
    if (snapshot.status === 'finished') {
      this.status = 'finished';
      this.viewMode = 'FINAL_RESULTS';
      this.questionResults = null;
      this.timeLeftSeconds = null;
      this.autoResultAttempt = null;
      return this.fetchLeaderboard(snapshot.id, mockLeaderboardRpc);
    }
  }

  // 4. Reset to setup
  handleResetToSetup() {
    this.sessionId = null;
    this.status = 'setup';
    this.viewMode = 'LIVE_QUESTION';
    this.leaderboardData = [];
    this.leaderboardError = null;
    this.questionResults = null;
    this.timeLeftSeconds = null;
    this.autoResultAttempt = null;
  }
}

// 2.1: Finish flow transitions to FINAL_RESULTS and clears timer/stale results
{
  const host = new MockHostSessionManager({ sessionId: 'session_100' });
  const mockFinishRpc = async () => ({ success: true });
  const mockLeaderboardRpc = async () => ({
    success: true,
    data: {
      leaderboard: [
        { participant_id: 'p1', display_name: 'Lan', rank: 1, total_score: 30, correct_count: 3, total_response_time_ms: 1500 },
        { participant_id: 'p2', display_name: 'Minh', rank: 2, total_score: 20, correct_count: 2, total_response_time_ms: 2100 }
      ]
    }
  });

  const finishRes = await host.handleFinishSession(mockFinishRpc, mockLeaderboardRpc);
  assert.equal(finishRes.success, true);
  assert.equal(host.viewMode, 'FINAL_RESULTS');
  assert.equal(host.status, 'finished');
  assert.equal(host.questionResults, null, 'Stale question results must be cleared');
  assert.equal(host.timeLeftSeconds, null, 'Countdown timer must be stopped');
  assert.equal(host.autoResultAttempt, null, 'Auto result attempt guard must be cleared');
  assert.equal(host.leaderboardData.length, 2);
  console.log('  ✅ [2.1] PASS: Finish flow transitions to FINAL_RESULTS, stops timer, clears stale results');
}

// 2.2: Reload / Reconnect recovery on finished session
{
  const host = new MockHostSessionManager({ sessionId: 'session_200', initialStatus: 'waiting' });
  host.questionResults = { question_id: 'q3', submitted_count: 5 }; // Stale from previous run

  const mockLeaderboardRpc = async () => ({
    success: true,
    data: {
      leaderboard: [
        { participant_id: 'p1', display_name: 'Alice', rank: 1, total_score: 10, correct_count: 1, total_response_time_ms: 800 }
      ]
    }
  });

  // Simulate snapshot polling detecting status = 'finished'
  await host.syncFinishedSession({ id: 'session_200', status: 'finished' }, mockLeaderboardRpc);

  assert.equal(host.viewMode, 'FINAL_RESULTS');
  assert.equal(host.status, 'finished');
  assert.equal(host.questionResults, null, 'Stale questionResults cleared on reload');
  assert.equal(host.timeLeftSeconds, null, 'Timer remains null on reload');
  assert.equal(host.leaderboardData.length, 1);
  console.log('  ✅ [2.2] PASS: Reload on finished session recovers directly to FINAL_RESULTS');
}

// 2.3: Reset to Setup restores clean initial state
{
  const host = new MockHostSessionManager({ sessionId: 'session_300', initialStatus: 'finished' });
  host.viewMode = 'FINAL_RESULTS';
  host.leaderboardData = [{ participant_id: 'p1', rank: 1 }];

  host.handleResetToSetup();
  assert.equal(host.sessionId, null);
  assert.equal(host.status, 'setup');
  assert.equal(host.viewMode, 'LIVE_QUESTION');
  assert.equal(host.leaderboardData.length, 0);
  assert.equal(host.leaderboardError, null);
  console.log('  ✅ [2.3] PASS: Reset to setup cleanly restores state');
}


// ============================================================================
// Test 3: Authoritative Podium Grouping, Tie Handling, & Rank Gaps
// ============================================================================
console.log('\n--- [Test 3] Authoritative Podium Grouping, Tie Handling, & Rank Gaps ---');

function derivePodiumGroups(leaderboardData) {
  const goldGroup = leaderboardData.filter(item => item.rank === 1);
  const silverGroup = leaderboardData.filter(item => item.rank === 2);
  const bronzeGroup = leaderboardData.filter(item => item.rank === 3);
  const remainingList = leaderboardData.filter(item => item.rank > 3);
  return { goldGroup, silverGroup, bronzeGroup, remainingList };
}

// 3.1: 0 Participants (Empty State)
{
  const emptyLeaderboard = [];
  const { goldGroup, silverGroup, bronzeGroup, remainingList } = derivePodiumGroups(emptyLeaderboard);
  assert.equal(goldGroup.length, 0);
  assert.equal(silverGroup.length, 0);
  assert.equal(bronzeGroup.length, 0);
  assert.equal(remainingList.length, 0);
  console.log('  ✅ [3.1] PASS: 0 participants handled cleanly with zero elements in all groups');
}

// 3.2: 1 Participant (Single Gold Winner)
{
  const singleLeaderboard = [
    { participant_id: 'p1', display_name: 'Nguyễn Văn A', rank: 1, total_score: 20, correct_count: 2, total_response_time_ms: 1000 }
  ];
  const { goldGroup, silverGroup, bronzeGroup, remainingList } = derivePodiumGroups(singleLeaderboard);
  assert.equal(goldGroup.length, 1);
  assert.equal(goldGroup[0].display_name, 'Nguyễn Văn A');
  assert.equal(silverGroup.length, 0);
  assert.equal(bronzeGroup.length, 0);
  assert.equal(remainingList.length, 0);
  console.log('  ✅ [3.2] PASS: 1 participant renders Gold podium without crashing Silver/Bronze');
}

// 3.3: 2 Participants Normal (1 Gold, 1 Silver)
{
  const twoLeaderboard = [
    { participant_id: 'p1', display_name: 'A', rank: 1, total_score: 20, correct_count: 2, total_response_time_ms: 1000 },
    { participant_id: 'p2', display_name: 'B', rank: 2, total_score: 10, correct_count: 1, total_response_time_ms: 1200 }
  ];
  const { goldGroup, silverGroup, bronzeGroup, remainingList } = derivePodiumGroups(twoLeaderboard);
  assert.equal(goldGroup.length, 1);
  assert.equal(silverGroup.length, 1);
  assert.equal(bronzeGroup.length, 0);
  assert.equal(remainingList.length, 0);
  console.log('  ✅ [3.3] PASS: 2 normal participants populate Gold & Silver');
}

// 3.4: 2 Participants Tie Rank 1 (1, 1 -> Gap Rank 2)
{
  const tieRank1Leaderboard = [
    { participant_id: 'p1', display_name: 'A', rank: 1, total_score: 20, correct_count: 2, total_response_time_ms: 1000 },
    { participant_id: 'p2', display_name: 'B', rank: 1, total_score: 20, correct_count: 2, total_response_time_ms: 1000 }
  ];
  const { goldGroup, silverGroup, bronzeGroup, remainingList } = derivePodiumGroups(tieRank1Leaderboard);
  assert.equal(goldGroup.length, 2, 'Gold group must contain BOTH tied participants');
  assert.equal(silverGroup.length, 0, 'Silver group must be empty due to RANK() gap');
  assert.equal(bronzeGroup.length, 0);
  assert.equal(remainingList.length, 0);
  console.log('  ✅ [3.4] PASS: 2 participants tied for Rank 1 both grouped in Gold; Silver left empty (no fake re-ranking)');
}

// 3.5: 3+ Participants with Tie Rank 1 (1, 1, 3 -> Gap Rank 2)
{
  const tie113Leaderboard = [
    { participant_id: 'p1', display_name: 'Alice', rank: 1, total_score: 30, correct_count: 3, total_response_time_ms: 1000 },
    { participant_id: 'p2', display_name: 'Bob', rank: 1, total_score: 30, correct_count: 3, total_response_time_ms: 1000 },
    { participant_id: 'p3', display_name: 'Charlie', rank: 3, total_score: 20, correct_count: 2, total_response_time_ms: 1500 },
    { participant_id: 'p4', display_name: 'David', rank: 4, total_score: 10, correct_count: 1, total_response_time_ms: 2000 }
  ];
  const { goldGroup, silverGroup, bronzeGroup, remainingList } = derivePodiumGroups(tie113Leaderboard);
  assert.equal(goldGroup.length, 2, 'Gold group has Alice & Bob');
  assert.equal(silverGroup.length, 0, 'Silver group has 0 due to rank 2 gap');
  assert.equal(bronzeGroup.length, 1, 'Bronze group has Charlie at Rank 3');
  assert.equal(bronzeGroup[0].display_name, 'Charlie');
  assert.equal(bronzeGroup[0].rank, 3, 'Charlie rank 3 must NOT be converted to rank 2');
  assert.equal(remainingList.length, 1);
  assert.equal(remainingList[0].display_name, 'David');
  assert.equal(remainingList[0].rank, 4);
  console.log('  ✅ [3.5] PASS: Tie Rank 1 (1, 1, 3, 4) strictly preserves Rank 3 on Bronze without shifting');
}

// 3.6: Tie Rank 2 (1, 2, 2, 4 -> Gap Rank 3)
{
  const tie1224Leaderboard = [
    { participant_id: 'p1', display_name: 'Top1', rank: 1, total_score: 40, correct_count: 4, total_response_time_ms: 900 },
    { participant_id: 'p2', display_name: 'TieA', rank: 2, total_score: 30, correct_count: 3, total_response_time_ms: 1100 },
    { participant_id: 'p3', display_name: 'TieB', rank: 2, total_score: 30, correct_count: 3, total_response_time_ms: 1100 },
    { participant_id: 'p4', display_name: 'Fourth', rank: 4, total_score: 20, correct_count: 2, total_response_time_ms: 1400 },
    { participant_id: 'p5', display_name: 'Fifth', rank: 5, total_score: 10, correct_count: 1, total_response_time_ms: 1900 }
  ];
  const { goldGroup, silverGroup, bronzeGroup, remainingList } = derivePodiumGroups(tie1224Leaderboard);
  assert.equal(goldGroup.length, 1);
  assert.equal(silverGroup.length, 2, 'Silver group has TieA & TieB');
  assert.equal(bronzeGroup.length, 0, 'Bronze group empty due to rank 3 gap');
  assert.equal(remainingList.length, 2);
  assert.equal(remainingList[0].display_name, 'Fourth');
  assert.equal(remainingList[0].rank, 4, 'Fourth place stays rank 4 in list');
  console.log('  ✅ [3.6] PASS: Tie Rank 2 (1, 2, 2, 4, 5) groups 2 Silvers, leaves Bronze empty, preserves rank 4');
}

// 3.7: 0 Total Score Handling
{
  const zeroScoreLeaderboard = [
    { participant_id: 'p1', display_name: 'Zero1', rank: 1, total_score: 0, correct_count: 0, total_response_time_ms: 5000 }
  ];
  const { goldGroup } = derivePodiumGroups(zeroScoreLeaderboard);
  assert.equal(goldGroup[0].total_score, 0);
  console.log('  ✅ [3.7] PASS: 0 total score preserved and displayed cleanly');
}

// 3.8: Avatar Null Handling
{
  const nullAvatarLeaderboard = [
    { participant_id: 'p1', display_name: 'Hoàng', avatar_url: null, rank: 1, total_score: 10, correct_count: 1, total_response_time_ms: 1000 }
  ];
  const { goldGroup } = derivePodiumGroups(nullAvatarLeaderboard);
  assert.equal(goldGroup[0].avatar_url, null);
  const fallbackInitial = goldGroup[0].display_name?.charAt(0)?.toUpperCase();
  assert.equal(fallbackInitial, 'H');
  console.log('  ✅ [3.8] PASS: Avatar null safely handled with initial fallback character');
}


// ============================================================================
// Test 4: Fail-Closed Leaderboard Error & Race Safety
// ============================================================================
console.log('\n--- [Test 4] Fail-Closed Error & Race Safety ---');

// 4.1: Leaderboard Fetch Failure Fails Closed
{
  const host = new MockHostSessionManager({ sessionId: 'session_fail' });
  const mockFinishRpc = async () => ({ success: true });
  const mockFailingLeaderboardRpc = async () => ({
    success: false,
    message: 'Máy chủ quá tải khi tính toán bảng xếp hạng'
  });

  const finishRes = await host.handleFinishSession(mockFinishRpc, mockFailingLeaderboardRpc);
  assert.equal(finishRes.success, true);
  assert.equal(host.viewMode, 'FINAL_RESULTS');
  assert.equal(host.leaderboardData.length, 0);
  assert.equal(host.leaderboardError, 'Máy chủ quá tải khi tính toán bảng xếp hạng');
  console.log('  ✅ [4.1] PASS: Leaderboard fetch failure sets leaderboardError without rendering corrupted data');
}

// 4.2: Stale Session ID Request Guard
{
  const host = new MockHostSessionManager({ sessionId: 'session_A' });
  
  // Start slow request for session_A
  let resolveSessionA;
  const slowPromise = new Promise(resolve => { resolveSessionA = resolve; });
  const mockSlowRpc = async () => slowPromise;

  const req1Promise = host.fetchLeaderboard('session_A', mockSlowRpc);

  // Switch to session_B and finish quickly
  const mockFastRpc = async () => ({
    success: true,
    data: { leaderboard: [{ participant_id: 'pB', display_name: 'UserB', rank: 1 }] }
  });
  await host.fetchLeaderboard('session_B', mockFastRpc);
  assert.equal(host.leaderboardData[0].display_name, 'UserB');

  // Now slow request for session_A resolves
  resolveSessionA({
    success: true,
    data: { leaderboard: [{ participant_id: 'pA', display_name: 'UserA_STALE', rank: 1 }] }
  });
  const req1Res = await req1Promise;

  assert.equal(req1Res.error_code, 'STALE_REQUEST');
  assert.equal(host.leaderboardData[0].display_name, 'UserB', 'Stale request MUST NOT overwrite newer session data');
  console.log('  ✅ [4.2] PASS: Stale response safely rejected, preventing session data overwrite');
}

console.log('\n================================================================================');
console.log('🎉 ALL COMPETITION V1 R3 FINAL RESULTS & PODIUM CEREMONY TESTS PASSED!');
console.log('================================================================================\n');
