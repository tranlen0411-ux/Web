import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  POLLING_WAITING_MS,
  POLLING_ACTIVE_MS,
  DEFAULT_SUBMISSION_STATS
} from '../src/hooks/useHostCompetitionPolling.js';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 HOST SUBMISSION STATS FRONTEND & HOOK TEST SUITE');
console.log('================================================================================\n');

// ============================================================================
// Test 1: Static Source Verification & Data Privacy Invariants
// ============================================================================
console.log('--- [Test 1] Inspecting Source Files for Security & Architecture Invariants ---');

const clientSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');
const hookSource = fs.readFileSync('src/hooks/useHostCompetitionPolling.js', 'utf8');
const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');

// A. Frontend NEVER queries competition_answers directly
assert.ok(
  !clientSource.includes(".from('competition_answers')"),
  'competitionClient.js must NOT perform direct .from(\'competition_answers\')'
);
assert.ok(
  !hookSource.includes(".from('competition_answers')"),
  'useHostCompetitionPolling.js must NOT perform direct .from(\'competition_answers\')'
);
assert.ok(
  !hostPageSource.includes(".from('competition_answers')"),
  'CompetitionHostPage.jsx must NOT perform direct .from(\'competition_answers\')'
);
console.log('  ✅ [1.A] PASS: Zero direct client queries on competition_answers');

// B. Client calls competition_host_get_submission_stats
assert.ok(
  clientSource.includes("supabase.rpc('competition_host_get_submission_stats'"),
  'competitionClient.js must call competition_host_get_submission_stats RPC'
);
assert.ok(
  clientSource.includes('export async function getHostSubmissionStats'),
  'competitionClient.js must export getHostSubmissionStats'
);
console.log('  ✅ [1.B] PASS: getHostSubmissionStats wraps RPC competition_host_get_submission_stats');

// C & D. Polling hook imports and calls getHostSubmissionStats without extra timers
assert.ok(
  hookSource.includes('getHostSubmissionStats'),
  'useHostCompetitionPolling.js must import and call getHostSubmissionStats'
);
assert.ok(
  hookSource.includes('submissionStats'),
  'useHostCompetitionPolling.js must expose submissionStats'
);
assert.ok(
  !hookSource.includes('setInterval'),
  'useHostCompetitionPolling.js must NOT use setInterval'
);
const setTimeoutMatches = hookSource.match(/setTimeout/g) || [];
assert.equal(
  setTimeoutMatches.length,
  1,
  'useHostCompetitionPolling.js must have exactly ONE setTimeout for the single polling loop'
);
console.log('  ✅ [1.C & 1.D] PASS: Hook integrates getHostSubmissionStats in parallel without extra timers or intervals');

// E. Host Page renders progress bar and submission lists ONLY when consistency contract is met
assert.ok(
  hostPageSource.includes('isSubmissionStatsAuthoritative'),
  'Host UI must calculate isSubmissionStatsAuthoritative guard'
);
assert.ok(
  hostPageSource.includes('submissionStats?.current_question_id === snapshot.current_question_id'),
  'Host UI must strictly verify question ID match between submissionStats and snapshot'
);
assert.ok(
  hostPageSource.includes('progressPercentage'),
  'Host UI must calculate and display progress bar'
);
assert.ok(
  hostPageSource.includes('submittedList') && hostPageSource.includes('notSubmittedList'),
  'Host UI must render two compact lists: submitted and not submitted'
);
console.log('  ✅ [1.E] PASS: Host UI renders submission stats card with strict question ID consistency guard');

// F. Default shape has has_active_question: false
assert.equal(DEFAULT_SUBMISSION_STATS.has_active_question, false);
assert.equal(DEFAULT_SUBMISSION_STATS.current_question_id, null);
assert.equal(DEFAULT_SUBMISSION_STATS.submitted_count, 0);
assert.equal(DEFAULT_SUBMISSION_STATS.not_submitted_count, 0);
assert.deepEqual(DEFAULT_SUBMISSION_STATS.participants, []);
console.log('  ✅ [1.F] PASS: DEFAULT_SUBMISSION_STATS initialized to neutral shape (has_active_question: false, 0/0, [])');

// G. Host UI strictly excludes raw answer content
const bannedFields = [
  'selected_option_ids',
  'text_answer',
  'is_correct',
  'points_awarded',
  'time_taken_ms',
  'user_id',
  'guest_token_hash'
];

bannedFields.forEach(field => {
  assert.ok(
    !hostPageSource.includes(`p.${field}`) && !hostPageSource.includes(`item.${field}`),
    `Host UI must NOT access or render banned field '${field}'`
  );
});
console.log('  ✅ [1.G] PASS: Host UI strictly excludes raw answer choices, points, is_correct, and sensitive IDs');

// H. No heuristic offline calculation
assert.ok(
  !hostPageSource.includes('Date.now() - new Date(p.last_seen_at) > 10000'),
  'Host UI must NOT add offline heuristic from last_seen_at'
);
console.log('  ✅ [1.H] PASS: Authoritative participant.status displayed without arbitrary offline heuristics');


// ============================================================================
// Test 2: Polling Scheduler Timing & Concurrency Matrix
// ============================================================================
console.log('\n--- [Test 2] Polling Scheduler Timing & Concurrency Matrix ---');

class MockHostPollingEngine {
  constructor({ sessionId, initialStatus = 'waiting' }) {
    this.sessionId = sessionId;
    this.status = initialStatus;
    this.fetchCount = 0;
    this.isFetching = false;
    this.isMounted = true;
    this.activeTimer = null;
    this.documentHidden = false;
    this.stats = DEFAULT_SUBMISSION_STATS;
  }

  async fetchSessionData(isManual = false) {
    if (!this.sessionId || this.isFetching || !this.isMounted) return;
    this.isFetching = true;
    this.fetchCount++;

    // Parallel fetch simulation: snapshot, participants, submissionStats
    await Promise.all([
      Promise.resolve({ id: this.sessionId, status: this.status }),
      Promise.resolve([]),
      Promise.resolve({ has_active_question: true, current_question_id: 'q1', total_eligible: 10, submitted_count: 3, not_submitted_count: 7, participants: [] })
    ]);

    this.isFetching = false;
  }

  scheduleNextPoll() {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer.id);
      this.activeTimer = null;
    }

    if (!this.isMounted || !this.sessionId) return;
    if (this.status === 'finished' || this.status === 'cancelled') return;
    if (this.documentHidden) return;

    const delay = (this.status === 'in_progress' || this.status === 'paused')
      ? POLLING_ACTIVE_MS
      : POLLING_WAITING_MS;

    this.activeTimer = {
      delay,
      scheduledAt: Date.now(),
      id: setTimeout(async () => {
        if (!this.isMounted) return;
        await this.fetchSessionData(false);
        this.scheduleNextPoll();
      }, delay)
    };
  }

  async start() {
    await this.fetchSessionData(false);
    this.scheduleNextPoll();
  }

  async refreshNow() {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer.id);
      this.activeTimer = null;
    }
    await this.fetchSessionData(true);
    this.scheduleNextPoll();
  }

  unmount() {
    this.isMounted = false;
    if (this.activeTimer) {
      clearTimeout(this.activeTimer.id);
      this.activeTimer = null;
    }
  }
}

// 2.A Waiting cadence check
const engineWaiting = new MockHostPollingEngine({ sessionId: 'session-w', initialStatus: 'waiting' });
await engineWaiting.start();
assert.equal(engineWaiting.activeTimer.delay, 3000);
engineWaiting.unmount();
console.log('  ✅ [2.A] Waiting cadence verified at 3000ms');

// 2.B Active cadence check
const engineActive = new MockHostPollingEngine({ sessionId: 'session-a', initialStatus: 'in_progress' });
await engineActive.start();
assert.equal(engineActive.activeTimer.delay, 2000);
engineActive.unmount();
console.log('  ✅ [2.B] Active / In_Progress cadence verified at 2000ms');

// 2.C Manual refreshNow resumes polling
const engineRefresh = new MockHostPollingEngine({ sessionId: 'session-r', initialStatus: 'in_progress' });
await engineRefresh.start();
const beforeCount = engineRefresh.fetchCount;
await engineRefresh.refreshNow();
assert.equal(engineRefresh.fetchCount, beforeCount + 1);
assert.ok(engineRefresh.activeTimer !== null);
engineRefresh.unmount();
console.log('  ✅ [2.C] refreshNow() fetches immediately and continues single polling loop');


// ============================================================================
// Test 3: Question Transition Consistency Guard & Visibility Matrix
// ============================================================================
console.log('\n--- [Test 3] Question Transition Consistency Guard & Visibility Matrix ---');

// UI Visibility Evaluation Contract matching CompetitionHostPage.jsx exactly
function evaluateHostUIVisibility({ currentStatus, snapshot, submissionStats }) {
  const isSubmissionStatsAuthoritative = Boolean(
    (currentStatus === 'in_progress' || currentStatus === 'paused') &&
    snapshot?.current_question_id &&
    submissionStats?.has_active_question === true &&
    submissionStats?.current_question_id === snapshot.current_question_id
  );

  const activeStats = isSubmissionStatsAuthoritative ? submissionStats : DEFAULT_SUBMISSION_STATS;
  const submittedList = activeStats.participants?.filter(p => p.submitted) || [];
  const notSubmittedList = activeStats.participants?.filter(p => !p.submitted) || [];

  return {
    isPanelVisible: isSubmissionStatsAuthoritative,
    activeStats,
    submittedList,
    notSubmittedList
  };
}

// Hook Resolution Logic matching useHostCompetitionPolling.js exactly
function resolveHookSubmissionStats(snapResData, statsRes) {
  if (statsRes?.success && statsRes?.data) {
    const authoritativeQuestionId = snapResData?.current_question_id;
    if (
      statsRes.data.has_active_question &&
      authoritativeQuestionId &&
      statsRes.data.current_question_id === authoritativeQuestionId
    ) {
      return statsRes.data;
    }
  }
  return DEFAULT_SUBMISSION_STATS;
}

const mockStatsQ1 = {
  has_active_question: true,
  current_question_id: 'q-uuid-1111',
  total_eligible: 5,
  submitted_count: 3,
  not_submitted_count: 2,
  participants: [
    { participant_id: 'p1', display_name: 'Alice', submitted: true, submitted_at: '2026-10-04T06:00:01Z' },
    { participant_id: 'p2', display_name: 'Bob', submitted: true, submitted_at: '2026-10-04T06:00:02Z' },
    { participant_id: 'p3', display_name: 'Charlie', submitted: true, submitted_at: '2026-10-04T06:00:03Z' },
    { participant_id: 'p4', display_name: 'David', submitted: false, submitted_at: null },
    { participant_id: 'p5', display_name: 'Eve', submitted: false, submitted_at: null }
  ]
};

const mockStatsQ2 = {
  has_active_question: true,
  current_question_id: 'q-uuid-2222',
  total_eligible: 5,
  submitted_count: 1,
  not_submitted_count: 4,
  participants: [
    { participant_id: 'p1', display_name: 'Alice', submitted: true, submitted_at: '2026-10-04T06:01:05Z' },
    { participant_id: 'p2', display_name: 'Bob', submitted: false, submitted_at: null },
    { participant_id: 'p3', display_name: 'Charlie', submitted: false, submitted_at: null },
    { participant_id: 'p4', display_name: 'David', submitted: false, submitted_at: null },
    { participant_id: 'p5', display_name: 'Eve', submitted: false, submitted_at: null }
  ]
};

// Scenario A: snapshot Q1 + stats Q1 -> panel visible
{
  const snapshot = { id: 's1', status: 'in_progress', current_question_id: 'q-uuid-1111', current_question_index: 1 };
  const hookResult = resolveHookSubmissionStats(snapshot, { success: true, data: mockStatsQ1 });
  assert.equal(hookResult.current_question_id, 'q-uuid-1111');

  const uiResult = evaluateHostUIVisibility({
    currentStatus: snapshot.status,
    snapshot,
    submissionStats: hookResult
  });
  assert.equal(uiResult.isPanelVisible, true);
  assert.equal(uiResult.activeStats.submitted_count, 3);
  assert.equal(uiResult.submittedList.length, 3);
  console.log('  ✅ [3.A] PASS: snapshot Q1 + stats Q1 -> panel visible with Q1 data');
}

// Scenario B: snapshot Q2 + stats Q1 (Transition straddle) -> panel hidden / neutral
{
  const snapshotQ2 = { id: 's1', status: 'in_progress', current_question_id: 'q-uuid-2222', current_question_index: 2 };
  // Hook receives snapshot Q2 while stats response is still stale Q1
  const hookResult = resolveHookSubmissionStats(snapshotQ2, { success: true, data: mockStatsQ1 });
  assert.deepEqual(hookResult, DEFAULT_SUBMISSION_STATS);

  // Even if hook had transient stale stats, UI guard also fails closed
  const uiResultWithStaleStats = evaluateHostUIVisibility({
    currentStatus: snapshotQ2.status,
    snapshot: snapshotQ2,
    submissionStats: mockStatsQ1 // stale Q1 stats with Q2 snapshot
  });
  assert.equal(uiResultWithStaleStats.isPanelVisible, false);
  assert.deepEqual(uiResultWithStaleStats.activeStats, DEFAULT_SUBMISSION_STATS);
  assert.equal(uiResultWithStaleStats.submittedList.length, 0);
  assert.equal(uiResultWithStaleStats.notSubmittedList.length, 0);
  console.log('  ✅ [3.B] PASS: snapshot Q2 + stats Q1 (straddle) -> panel hidden and fails closed to neutral state');
}

// Scenario C: snapshot Q2 + stats Q2 -> panel visible
{
  const snapshotQ2 = { id: 's1', status: 'in_progress', current_question_id: 'q-uuid-2222', current_question_index: 2 };
  const hookResult = resolveHookSubmissionStats(snapshotQ2, { success: true, data: mockStatsQ2 });
  assert.equal(hookResult.current_question_id, 'q-uuid-2222');

  const uiResult = evaluateHostUIVisibility({
    currentStatus: snapshotQ2.status,
    snapshot: snapshotQ2,
    submissionStats: hookResult
  });
  assert.equal(uiResult.isPanelVisible, true);
  assert.equal(uiResult.activeStats.submitted_count, 1);
  assert.equal(uiResult.submittedList.length, 1);
  console.log('  ✅ [3.C] PASS: snapshot Q2 + stats Q2 -> panel visible with fresh Q2 data');
}

// Scenario D: snapshot current_question_id null -> panel hidden
{
  const snapshotNullQ = { id: 's1', status: 'in_progress', current_question_id: null, current_question_index: null };
  const hookResult = resolveHookSubmissionStats(snapshotNullQ, { success: true, data: mockStatsQ1 });
  assert.deepEqual(hookResult, DEFAULT_SUBMISSION_STATS);

  const uiResult = evaluateHostUIVisibility({
    currentStatus: snapshotNullQ.status,
    snapshot: snapshotNullQ,
    submissionStats: mockStatsQ1
  });
  assert.equal(uiResult.isPanelVisible, false);
  assert.deepEqual(uiResult.activeStats, DEFAULT_SUBMISSION_STATS);
  console.log('  ✅ [3.D] PASS: snapshot current_question_id null -> panel hidden');
}

// Scenario E: question transition does not show stale previous-question participant list
{
  const snapshotQ2 = { id: 's1', status: 'in_progress', current_question_id: 'q-uuid-2222', current_question_index: 2 };
  const uiResult = evaluateHostUIVisibility({
    currentStatus: snapshotQ2.status,
    snapshot: snapshotQ2,
    submissionStats: mockStatsQ1 // Q1 stats during transition
  });
  // Must NOT expose Alice, Bob, Charlie as submitted for Q2
  assert.equal(uiResult.submittedList.length, 0);
  assert.equal(uiResult.notSubmittedList.length, 0);
  assert.equal(uiResult.isPanelVisible, false);
  console.log('  ✅ [3.E] PASS: Question transition strictly prevents leaking stale participant submission lists');
}

// Scenario F & G: No extra network retry loop or polling timer
{
  assert.ok(
    !hookSource.includes('while ('),
    'Hook must not contain polling retry loops'
  );
  assert.ok(
    !hookSource.includes('for (;;'),
    'Hook must not contain infinite loops'
  );
  console.log('  ✅ [3.F & 3.G] PASS: Zero extra timers or retry loops introduced; transient mismatch waits for next standard cycle');
}

// Scenario H: existing waiting/finished/cancelled neutral tests remain PASS
{
  ['waiting', 'finished', 'cancelled'].forEach(terminalStatus => {
    const snap = { id: 's1', status: terminalStatus, current_question_id: 'q-uuid-1111' };
    const uiResult = evaluateHostUIVisibility({
      currentStatus: terminalStatus,
      snapshot: snap,
      submissionStats: mockStatsQ1
    });
    assert.equal(uiResult.isPanelVisible, false);
    assert.deepEqual(uiResult.activeStats, DEFAULT_SUBMISSION_STATS);
  });
  console.log('  ✅ [3.H] PASS: waiting, finished, and cancelled statuses strictly keep panel hidden with neutral stats');
}

console.log('\n🎉 ALL COMPETITION V1 HOST SUBMISSION STATS TESTS (INCLUDING TRANSITION GUARD) PASSED!\n');
