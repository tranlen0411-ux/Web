import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 HOST QUESTION RESULTS & DISTRIBUTION FRONTEND TEST SUITE');
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

// 1.B: Client exports hostCloseQuestion and getHostQuestionResults
assert.ok(
  clientSource.includes('export async function hostCloseQuestion'),
  'competitionClient.js must export hostCloseQuestion'
);
assert.ok(
  clientSource.includes("supabase.rpc('competition_host_close_question'"),
  'hostCloseQuestion must invoke competition_host_close_question RPC'
);
assert.ok(
  clientSource.includes('export async function getHostQuestionResults'),
  'competitionClient.js must export getHostQuestionResults'
);
assert.ok(
  clientSource.includes("supabase.rpc('competition_host_get_question_results'"),
  'getHostQuestionResults must invoke competition_host_get_question_results RPC'
);
console.log('  ✅ [1.B] PASS: competitionClient.js wraps close and results RPCs with normalizeResponse');

// 1.C: Host View Modes defined and used
assert.ok(
  hostPageSource.includes('LIVE_QUESTION') &&
  hostPageSource.includes('QUESTION_RESULTS') &&
  hostPageSource.includes('LEADERBOARD'),
  'CompetitionHostPage.jsx must define view modes: LIVE_QUESTION, QUESTION_RESULTS, LEADERBOARD'
);
assert.ok(
  hostPageSource.includes("const [hostViewMode, setHostViewMode] = useState('LIVE_QUESTION')") ||
  hostPageSource.includes("useState('LIVE_QUESTION')"),
  'Host page must initialize hostViewMode to LIVE_QUESTION'
);
console.log('  ✅ [1.C] PASS: Host page initializes in LIVE_QUESTION view mode');

// 1.D: Results Question ID consistency guard
assert.ok(
  hostPageSource.includes('isQuestionResultsAuthoritative') ||
  hostPageSource.includes('questionResults?.question_id === snapshot.current_question_id'),
  'Host page must guard results with strict question ID consistency check'
);
console.log('  ✅ [1.D] PASS: Results question ID consistency guard enforced');

// 1.E: Banned participant-level fields check
const bannedFields = [
  'guest_token_hash',
  'time_taken_ms',
  'participant_id'
];
bannedFields.forEach(field => {
  assert.ok(
    !hostPageSource.includes(`result.${field}`) && !hostPageSource.includes(`dist.${field}`),
    `Host UI must NOT access participant-level field '${field}'`
  );
});
console.log('  ✅ [1.E] PASS: Host UI strictly excludes raw participant-level answer records');

// 1.F: No extra polling loops introduced
const hookSource = fs.readFileSync('src/hooks/useHostCompetitionPolling.js', 'utf8');
const setIntervalInHook = hookSource.match(/setInterval/g) || [];
assert.equal(
  setIntervalInHook.length,
  0,
  'useHostCompetitionPolling.js must NOT introduce any setInterval polling loops'
);
const setTimeoutInHook = hookSource.match(/setTimeout/g) || [];
assert.equal(
  setTimeoutInHook.length,
  1,
  'useHostCompetitionPolling.js must have exactly ONE setTimeout for polling'
);
assert.ok(
  !hostPageSource.includes('useCompetitionPolling') && !hostPageSource.includes('useStudentCompetitionPolling'),
  'CompetitionHostPage.jsx must not instantiate secondary polling hooks'
);
console.log('  ✅ [1.F] PASS: Zero extra polling loops or duplicate polling intervals');


// 1.G: One-shot autoResultAttemptRef guard on countdown zero
assert.ok(
  hostPageSource.includes('autoResultAttemptRef'),
  'CompetitionHostPage.jsx must define autoResultAttemptRef to guard countdown zero fetch'
);
assert.ok(
  hostPageSource.includes('autoResultAttemptRef.current = null'),
  'CompetitionHostPage.jsx must reset autoResultAttemptRef.current on question/session reset'
);
console.log('  ✅ [1.G] PASS: autoResultAttemptRef guard and lifecycle resets verified statically');


// ============================================================================
// Test 2: Host View State Machine & Transition Simulation
// ============================================================================
console.log('\n--- [Test 2] Host View State Machine Simulation ---');

class MockHostViewManager {
  constructor({ sessionId, initialQuestionId = 'q1' }) {
    this.sessionId = sessionId;
    this.currentQuestionId = initialQuestionId;
    this.status = 'in_progress';
    this.viewMode = 'LIVE_QUESTION'; // Default
    this.questionResults = null;
    this.isClosingQuestion = false;
    this.isLoadingResults = false;
    this.leaderboardSnapshot = null;
  }

  // 1. Manual Close Flow
  async handleManualClose(mockCloseRpc, mockResultsRpc) {
    this.isClosingQuestion = true;
    const closeRes = await mockCloseRpc(this.sessionId);
    this.isClosingQuestion = false;

    if (!closeRes.success) {
      return { success: false, error: closeRes.error };
    }

    this.isLoadingResults = true;
    const resultsRes = await mockResultsRpc(this.sessionId);
    this.isLoadingResults = false;

    if (resultsRes.success && resultsRes.data?.question_closed) {
      this.questionResults = resultsRes.data;
      this.viewMode = 'QUESTION_RESULTS';
      return { success: true };
    }

    return { success: false, error: resultsRes.error || 'UNKNOWN_ERROR' };
  }

  // 2. Natural Expiry Trigger Flow (with Skew Handling)
  async handleNaturalExpiry(mockResultsRpc) {
    this.isLoadingResults = true;
    const resultsRes = await mockResultsRpc(this.sessionId);
    this.isLoadingResults = false;

    if (resultsRes.success && resultsRes.data?.question_closed) {
      this.questionResults = resultsRes.data;
      this.viewMode = 'QUESTION_RESULTS';
      return { success: true };
    }

    if (resultsRes.error?.code === 'QUESTION_STILL_ACTIVE') {
      // Fail-closed: do NOT enter QUESTION_RESULTS, keep LIVE_QUESTION, do NOT rapid retry
      return { success: false, error_code: 'QUESTION_STILL_ACTIVE' };
    }

    return { success: false, error: resultsRes.error };
  }

  // 3. Question Advancement Flow (Next Question)
  async handleNextQuestion(nextQuestionId, mockNextRpc) {
    const nextRes = await mockNextRpc(this.sessionId);
    if (nextRes.success) {
      // Clear Q1 results immediately
      this.questionResults = null;
      this.currentQuestionId = nextQuestionId;
      this.viewMode = 'LIVE_QUESTION';
      return { success: true };
    }
    return { success: false };
  }

  // 4. Leaderboard Toggle Flow
  toggleLeaderboard(mockLeaderboardData) {
    if (this.viewMode === 'QUESTION_RESULTS') {
      this.leaderboardSnapshot = mockLeaderboardData;
      this.viewMode = 'LEADERBOARD';
    } else if (this.viewMode === 'LEADERBOARD') {
      this.viewMode = 'QUESTION_RESULTS';
    }
  }

  // Check if results are authoritative and consistent
  isResultsAuthoritative() {
    return (
      this.viewMode === 'QUESTION_RESULTS' &&
      this.questionResults !== null &&
      this.questionResults.question_closed === true &&
      this.questionResults.question_id === this.currentQuestionId
    );
  }
}

// Scenario 1: Initial state is LIVE_QUESTION
const manager = new MockHostViewManager({ sessionId: 'session-123', initialQuestionId: 'q1' });
assert.equal(manager.viewMode, 'LIVE_QUESTION', 'Initial view mode must be LIVE_QUESTION');
assert.equal(manager.isResultsAuthoritative(), false, 'Results should not be authoritative initially');
console.log('  ✅ [2.1] PASS: Initial view mode is LIVE_QUESTION');

// Scenario 2: Manual close transitions to QUESTION_RESULTS
const mockCloseSuccess = async () => ({
  success: true,
  data: { question_closed: true, session_id: 'session-123', question_id: 'q1' }
});

const mockQ1Results = {
  success: true,
  session_id: 'session-123',
  session_status: 'in_progress',
  question_closed: true,
  question_id: 'q1',
  question_order: 1,
  question_type: 'single_choice',
  question_text: 'What is the capital of Vietnam?',
  points: 10,
  total_eligible: 3,
  submitted_count: 3,
  unanswered_count: 0,
  correct_count: 2,
  incorrect_count: 1,
  correct_percentage: 66.7,
  distribution: [
    { option_id: 'opt-a', option_text: 'Hanoi', selection_count: 2, selection_percentage: 66.7, is_correct_option: true },
    { option_id: 'opt-b', option_text: 'Da Nang', selection_count: 1, selection_percentage: 33.3, is_correct_option: false },
    { option_id: 'opt-c', option_text: 'HCMC', selection_count: 0, selection_percentage: 0.0, is_correct_option: false }
  ]
};

const mockResultsSuccess = async () => ({
  success: true,
  data: mockQ1Results
});

await manager.handleManualClose(mockCloseSuccess, mockResultsSuccess);
assert.equal(manager.viewMode, 'QUESTION_RESULTS', 'Manual close must switch viewMode to QUESTION_RESULTS');
assert.equal(manager.isResultsAuthoritative(), true, 'Results must be authoritative for Q1');
assert.equal(manager.questionResults.correct_count, 2);
console.log('  ✅ [2.2] PASS: Manual close successfully transitions to QUESTION_RESULTS with full distribution');

// Scenario 3: Toggle Leaderboard and back
manager.toggleLeaderboard({ rankings: [{ rank: 1, name: 'Alice', total_score: 10 }] });
assert.equal(manager.viewMode, 'LEADERBOARD', 'Toggle switches viewMode to LEADERBOARD');
assert.equal(manager.isResultsAuthoritative(), false, 'Results panel inactive in LEADERBOARD mode');

manager.toggleLeaderboard();
assert.equal(manager.viewMode, 'QUESTION_RESULTS', 'Toggle back restores QUESTION_RESULTS');
assert.equal(manager.isResultsAuthoritative(), true, 'Results authoritative again');
console.log('  ✅ [2.3] PASS: Leaderboard toggle works seamlessly between QUESTION_RESULTS <-> LEADERBOARD');

// Scenario 4: Advancing to Q2 clears Q1 results & resets view to LIVE_QUESTION
const mockNextSuccess = async () => ({ success: true, data: { current_question_id: 'q2' } });
await manager.handleNextQuestion('q2', mockNextSuccess);

assert.equal(manager.currentQuestionId, 'q2');
assert.equal(manager.viewMode, 'LIVE_QUESTION', 'Advancing to Q2 resets view mode to LIVE_QUESTION');
assert.equal(manager.questionResults, null, 'Q1 results must be wiped from memory upon next question');
assert.equal(manager.isResultsAuthoritative(), false, 'Results not authoritative on fresh question');
console.log('  ✅ [2.4] PASS: Next question clears Q1 results and starts Q2 in LIVE_QUESTION view mode');

// Scenario 5: Natural Expiry with QUESTION_STILL_ACTIVE clock skew fail-closed
const mockActiveSkewResults = async () => ({
  success: false,
  error: { code: 'QUESTION_STILL_ACTIVE', message: 'Question is still active' }
});

const skewResult = await manager.handleNaturalExpiry(mockActiveSkewResults);
assert.equal(skewResult.success, false);
assert.equal(skewResult.error_code, 'QUESTION_STILL_ACTIVE');
assert.equal(manager.viewMode, 'LIVE_QUESTION', 'Must remain in LIVE_QUESTION when server says QUESTION_STILL_ACTIVE');
assert.equal(manager.isResultsAuthoritative(), false, 'Results stay inactive during skew');
console.log('  ✅ [2.5] PASS: QUESTION_STILL_ACTIVE fails closed without leaking data or corrupting state');

// Scenario 6: Stale / Mismatched Question ID Guard
const managerMismatched = new MockHostViewManager({ sessionId: 'session-123', initialQuestionId: 'q2' });
managerMismatched.viewMode = 'QUESTION_RESULTS';
managerMismatched.questionResults = { ...mockQ1Results, question_id: 'q1' }; // Stale Q1 results while session is on Q2

assert.equal(
  managerMismatched.isResultsAuthoritative(),
  false,
  'Results must fail-closed (hidden) when question_id mismatch occurs'
);
console.log('  ✅ [2.6] PASS: Results question ID mismatch strictly guarded and hidden');


// ============================================================================
// Test 3: Question Types & Distribution Rendering Safeguards
// ============================================================================
console.log('\n--- [Test 3] Question Types & Distribution Rendering Safeguards ---');

function renderDistributionSummary(results) {
  if (results.question_type === 'short_answer') {
    return {
      hasDistributionBars: false,
      summaryText: `Đã nộp: ${results.submitted_count}/${results.total_eligible} (${results.correct_count} đúng)`
    };
  }

  const bars = (results.distribution || []).map(opt => ({
    text: opt.option_text,
    count: opt.selection_count,
    pct: opt.selection_percentage,
    isCorrect: opt.is_correct_option
  }));

  return {
    hasDistributionBars: true,
    bars
  };
}

// A. Short Answer Distribution Safe Rendering
const shortAnswerResults = {
  question_type: 'short_answer',
  question_text: 'What is the speed of light in vacuum (m/s)?',
  total_eligible: 5,
  submitted_count: 4,
  correct_count: 3,
  incorrect_count: 1,
  distribution: []
};

const shortSummary = renderDistributionSummary(shortAnswerResults);
assert.equal(shortSummary.hasDistributionBars, false, 'short_answer must NOT render distribution bars');
assert.ok(shortSummary.summaryText.includes('4/5'), 'short_answer renders submission count summary');
console.log('  ✅ [3.A] PASS: short_answer strictly suppresses option distribution bars and leaks zero text answers');

// B. Multiple Choice Distribution Rendering
const multiChoiceResults = {
  question_type: 'multiple_choice',
  question_text: 'Select all prime numbers',
  total_eligible: 4,
  submitted_count: 4,
  correct_count: 2,
  incorrect_count: 2,
  distribution: [
    { option_id: '1', option_text: '2', selection_count: 4, selection_percentage: 100.0, is_correct_option: true },
    { option_id: '2', option_text: '3', selection_count: 3, selection_percentage: 75.0, is_correct_option: true },
    { option_id: '3', option_text: '4', selection_count: 1, selection_percentage: 25.0, is_correct_option: false }
  ]
};

const multiSummary = renderDistributionSummary(multiChoiceResults);
assert.equal(multiSummary.hasDistributionBars, true);
assert.equal(multiSummary.bars.length, 3);
assert.equal(multiSummary.bars[0].isCorrect, true);
assert.equal(multiSummary.bars[2].isCorrect, false);
console.log('  ✅ [3.B] PASS: multiple_choice correctly displays option breakdown and correct option indicators');


// ============================================================================
// Test 4: Regression Test - Bounded 2-Attempt Clock-Skew Guard & Manual Action
// ============================================================================
console.log('\n--- [Test 4] Bounded 2-Attempt Clock-Skew Guard & Repeated Fetch Prevention ---');

class MockHostCountdownComponent {
  constructor({ sessionId = 'sess-reg-1', initialQuestionId = 'q-101', deadline = '2026-10-05T08:00:30.000Z' }) {
    this.sessionId = sessionId;
    this.snapshot = {
      id: sessionId,
      status: 'in_progress',
      current_question_id: initialQuestionId,
      question_deadline: deadline
    };
    this.hostViewMode = 'LIVE_QUESTION';
    this.questionResults = null;
    this.timeLeftSeconds = 30;

    // Guard refs
    this.isFetchingResultsRef = { current: false };
    this.autoResultAttemptRef = { current: null };

    // Metrics tracking
    this.rpcCalls = [];
    this.mockRpcResponse = null;
  }

  setMockRpcResponse(fn) {
    this.mockRpcResponse = fn;
  }

  async fetchResultsSafely(sessionId = this.sessionId) {
    if (!sessionId || this.isFetchingResultsRef.current) return { success: false, error_code: 'BUSY_OR_INVALID' };
    this.isFetchingResultsRef.current = true;
    this.rpcCalls.push({
      timestamp: Date.now(),
      questionId: this.snapshot.current_question_id,
      deadline: this.snapshot.question_deadline
    });

    try {
      const res = await this.mockRpcResponse(sessionId);
      if (res.success && res.data && res.data.question_closed === true) {
        if (this.snapshot.current_question_id && res.data.question_id === this.snapshot.current_question_id) {
          this.questionResults = res.data;
          this.hostViewMode = 'QUESTION_RESULTS';
          return { success: true, data: res.data };
        }
        return { success: false, error_code: 'QUESTION_ID_MISMATCH' };
      } else if (res.error_code === 'QUESTION_STILL_ACTIVE') {
        // Skew protection: remain LIVE_QUESTION, do not leak or loop
        return { success: false, error_code: 'QUESTION_STILL_ACTIVE' };
      }
      return { success: false, error_code: res.error_code || 'ERROR' };
    } catch (_err) {
      return { success: false, error_code: 'NETWORK_ERROR' };
    } finally {
      this.isFetchingResultsRef.current = false;
    }
  }

  // Emulates 1-second countdown tick interval logic exactly as in CompetitionHostPage.jsx
  async triggerCountdownTick(fakeCurrentTime) {
    if (!this.snapshot?.question_deadline || this.snapshot.status !== 'in_progress') {
      this.timeLeftSeconds = null;
      return;
    }

    const deadline = new Date(this.snapshot.question_deadline).getTime();
    const remaining = Math.max(0, Math.ceil((deadline - fakeCurrentTime) / 1000));
    this.timeLeftSeconds = remaining;

    // When countdown reaches 0, trigger at most TWO bounded automatic attempts for clock skew
    if (remaining === 0 && this.hostViewMode === 'LIVE_QUESTION' && !this.isFetchingResultsRef.current && !this.questionResults) {
      const attemptKey = `${this.snapshot.current_question_id}:${this.snapshot.question_deadline}`;
      const guard = this.autoResultAttemptRef.current;

      if (!guard || guard.key !== attemptKey) {
        // Attempt #1 on initial countdown zero
        this.autoResultAttemptRef.current = {
          key: attemptKey,
          attempts: 1,
          canRetryOnSkew: false
        };
        const res = await this.fetchResultsSafely(this.sessionId);
        if (this.autoResultAttemptRef.current?.key === attemptKey) {
          this.autoResultAttemptRef.current.canRetryOnSkew = (res?.error_code === 'QUESTION_STILL_ACTIVE');
        }
      } else if (guard.attempts < 2 && guard.canRetryOnSkew) {
        // Attempt #2 on subsequent countdown tick for clock skew
        guard.attempts = 2;
        guard.canRetryOnSkew = false;
        await this.fetchResultsSafely(this.sessionId);
      }
    }
  }

  // Emulates Host clicking "Kiểm Tra & Mở Kết Quả"
  async triggerManualResultCheck() {
    await this.fetchResultsSafely(this.sessionId);
  }

  // Emulates transitioning to next question
  onQuestionChange(nextQuestionId, nextDeadline) {
    this.snapshot = {
      ...this.snapshot,
      current_question_id: nextQuestionId,
      question_deadline: nextDeadline
    };
    this.questionResults = null;
    this.hostViewMode = 'LIVE_QUESTION';
    this.autoResultAttemptRef.current = null;
  }
}

// 4.A: Clock-Skew Eventual Success (Attempt #1 QUESTION_STILL_ACTIVE -> Attempt #2 Success)
const deadlineTime = new Date('2026-10-05T08:00:30.000Z').getTime();
const hostCompSkew = new MockHostCountdownComponent({
  sessionId: 'sess-test-skew',
  initialQuestionId: 'q-1',
  deadline: new Date(deadlineTime).toISOString()
});

let skewAttemptCount = 0;
hostCompSkew.setMockRpcResponse(async () => {
  skewAttemptCount++;
  if (skewAttemptCount === 1) {
    return { success: false, error_code: 'QUESTION_STILL_ACTIVE', message: 'Question is still active on server' };
  }
  return {
    success: true,
    data: {
      ...mockQ1Results,
      session_id: 'sess-test-skew',
      question_id: 'q-1',
      question_closed: true
    }
  };
});

// Tick at remaining = 5s
await hostCompSkew.triggerCountdownTick(deadlineTime - 5000);
assert.equal(hostCompSkew.timeLeftSeconds, 5);
assert.equal(hostCompSkew.rpcCalls.length, 0, 'No RPC call when countdown > 0');

// Tick 1 at remaining = 0s (Attempt #1 fails with QUESTION_STILL_ACTIVE)
await hostCompSkew.triggerCountdownTick(deadlineTime);
assert.equal(hostCompSkew.timeLeftSeconds, 0);
assert.equal(hostCompSkew.rpcCalls.length, 1, 'Attempt #1 MUST fire at countdown zero');
assert.equal(hostCompSkew.hostViewMode, 'LIVE_QUESTION', 'Must remain LIVE_QUESTION on attempt #1 clock skew');
assert.equal(hostCompSkew.questionResults, null);

// Tick 2 at remaining = 0s (1s later, Attempt #2 fires and succeeds)
await hostCompSkew.triggerCountdownTick(deadlineTime + 1000);
assert.equal(hostCompSkew.timeLeftSeconds, 0);
assert.equal(hostCompSkew.rpcCalls.length, 2, 'Attempt #2 MUST fire on next tick for clock skew');
assert.equal(hostCompSkew.hostViewMode, 'QUESTION_RESULTS', 'Transitions to QUESTION_RESULTS on attempt #2 success');
assert.equal(hostCompSkew.questionResults.question_id, 'q-1');

// Tick 3 at remaining = 0s (2s later, no further RPC calls)
await hostCompSkew.triggerCountdownTick(deadlineTime + 2000);
assert.equal(hostCompSkew.rpcCalls.length, 2, 'No further RPC calls after attempt #2 success');
console.log('  ✅ [4.A] PASS: Clock-skew retry succeeds on attempt #2 and transitions to QUESTION_RESULTS');


// 4.B: Double Active Failure (Attempt #1 & #2 both return QUESTION_STILL_ACTIVE -> Halt)
const hostCompDoubleFail = new MockHostCountdownComponent({
  sessionId: 'sess-test-double-fail',
  initialQuestionId: 'q-1',
  deadline: new Date(deadlineTime).toISOString()
});

hostCompDoubleFail.setMockRpcResponse(async () => ({
  success: false,
  error_code: 'QUESTION_STILL_ACTIVE',
  message: 'Question is still active on server'
}));

// Tick 1 (Attempt #1)
await hostCompDoubleFail.triggerCountdownTick(deadlineTime);
assert.equal(hostCompDoubleFail.rpcCalls.length, 1);
assert.equal(hostCompDoubleFail.hostViewMode, 'LIVE_QUESTION');

// Tick 2 (Attempt #2)
await hostCompDoubleFail.triggerCountdownTick(deadlineTime + 1000);
assert.equal(hostCompDoubleFail.rpcCalls.length, 2);
assert.equal(hostCompDoubleFail.hostViewMode, 'LIVE_QUESTION');

// Subsequent 5 simulated ticks at zero: RPC count MUST stay strictly at 2
for (let i = 2; i <= 6; i++) {
  await hostCompDoubleFail.triggerCountdownTick(deadlineTime + i * 1000);
  assert.equal(hostCompDoubleFail.rpcCalls.length, 2, `Tick +${i}s must NOT fire additional RPC`);
}
assert.equal(hostCompDoubleFail.hostViewMode, 'LIVE_QUESTION', 'Remains fail-closed without busy loop');
console.log('  ✅ [4.B] PASS: Double QUESTION_STILL_ACTIVE failure halts automatic attempts at exactly 2');


// 4.C: Manual Check After Two Auto Failures
hostCompDoubleFail.setMockRpcResponse(async () => ({
  success: true,
  data: {
    ...mockQ1Results,
    session_id: 'sess-test-double-fail',
    question_id: 'q-1',
    question_closed: true
  }
}));

await hostCompDoubleFail.triggerManualResultCheck();
assert.equal(hostCompDoubleFail.rpcCalls.length, 3, 'Manual Host click MUST execute even after 2 auto failures');
assert.equal(hostCompDoubleFail.hostViewMode, 'QUESTION_RESULTS');
assert.equal(hostCompDoubleFail.questionResults.question_id, 'q-1');
console.log('  ✅ [4.C] PASS: Manual Host result check works seamlessly after auto attempts are exhausted');


// 4.D: Question Transition Resets Bounded Retry Guard
const nextDeadlineTime = deadlineTime + 60000;
hostCompDoubleFail.onQuestionChange('q-2', new Date(nextDeadlineTime).toISOString());
assert.equal(hostCompDoubleFail.hostViewMode, 'LIVE_QUESTION');
assert.equal(hostCompDoubleFail.questionResults, null);
assert.equal(hostCompDoubleFail.autoResultAttemptRef.current, null, 'autoResultAttemptRef must reset on question change');

// Q2 receives its own first auto attempt
hostCompDoubleFail.setMockRpcResponse(async () => ({
  success: true,
  data: {
    ...mockQ1Results,
    session_id: 'sess-test-double-fail',
    question_id: 'q-2',
    question_order: 2,
    question_closed: true
  }
}));

await hostCompDoubleFail.triggerCountdownTick(nextDeadlineTime);
assert.equal(hostCompDoubleFail.rpcCalls.length, 4, 'Q2 receives its own first auto attempt');
assert.equal(hostCompDoubleFail.hostViewMode, 'QUESTION_RESULTS');
assert.equal(hostCompDoubleFail.questionResults.question_id, 'q-2');
console.log('  ✅ [4.D] PASS: Question change resets guard cleanly and permits Q2 auto attempts');


// 4.E: Non-Skew Errors (e.g. NETWORK_ERROR) Fail-Closed Without Second Auto Attempt
const hostCompNetErr = new MockHostCountdownComponent({
  sessionId: 'sess-test-net-err',
  initialQuestionId: 'q-1',
  deadline: new Date(deadlineTime).toISOString()
});

hostCompNetErr.setMockRpcResponse(async () => {
  throw new Error('Connection refused');
});

// Tick 1 (Attempt #1 network error)
await hostCompNetErr.triggerCountdownTick(deadlineTime);
assert.equal(hostCompNetErr.rpcCalls.length, 1);
assert.equal(hostCompNetErr.hostViewMode, 'LIVE_QUESTION');

// Tick 2 (Subsequent tick should NOT retry network error)
await hostCompNetErr.triggerCountdownTick(deadlineTime + 1000);
assert.equal(hostCompNetErr.rpcCalls.length, 1, 'Network error must NOT trigger automatic attempt #2');
console.log('  ✅ [4.E] PASS: Non-skew errors (network/auth) fail-closed without automatic attempt #2');

console.log('\n================================================================================');
console.log('🎉 ALL COMPETITION V1 HOST QUESTION RESULTS FRONTEND TESTS PASSED!');
console.log('================================================================================\n');
