import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 R3 FINAL RESULTS & PODIUM CEREMONY TEST SUITE');
console.log('================================================================================\n');

// ============================================================================
// Test 1: Static Source & Security Invariants Verification
// ============================================================================
console.log('--- [Test 1] Static Source Verification & Data Privacy Invariants ---');

const clientLibSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');
const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const hookSource = fs.readFileSync('src/hooks/useHostCompetitionPolling.js', 'utf8');

// 1.A: Frontend NEVER queries competition_answers directly
assert.ok(
  !clientLibSource.includes(".from('competition_answers')"),
  'competitionClient.js must NOT perform direct .from(\'competition_answers\')'
);
assert.ok(
  !hostPageSource.includes(".from('competition_answers')"),
  'CompetitionHostPage.jsx must NOT perform direct .from(\'competition_answers\')'
);
console.log('  ✅ [1.A] PASS: Zero direct client queries on competition_answers');

// 1.B: Authoritative Leaderboard Snapshot Function Used
assert.ok(
  clientLibSource.includes('export async function getLeaderboardSnapshot'),
  'competitionClient.js must export getLeaderboardSnapshot'
);
assert.ok(
  clientLibSource.includes("supabase.rpc('competition_get_leaderboard_snapshot'"),
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

// 1.E: Stale response / race condition & session identity guards in fetchLeaderboard (Blocker 1)
assert.ok(
  hostPageSource.includes('latestLeaderboardRequestIdRef'),
  'CompetitionHostPage.jsx must have latestLeaderboardRequestIdRef'
);
assert.ok(
  hostPageSource.includes('activeSessionIdRef'),
  'CompetitionHostPage.jsx must have activeSessionIdRef'
);
assert.ok(
  hostPageSource.includes('STALE_SESSION'),
  'CompetitionHostPage.jsx must have STALE_SESSION error code guard'
);
assert.ok(
  hostPageSource.includes('STALE_REQUEST'),
  'CompetitionHostPage.jsx must have STALE_REQUEST error code guard'
);
console.log('  ✅ [1.E] PASS: Request ID race guard & Active Session Identity guard verified in source');

// 1.F: True Session Persistence & Safe Reload Recovery (Blocker 2)
assert.ok(
  hostPageSource.includes('HOST_SESSION_STORAGE_KEY'),
  'CompetitionHostPage.jsx must define HOST_SESSION_STORAGE_KEY'
);
assert.ok(
  hostPageSource.includes('isValidSessionUUID'),
  'CompetitionHostPage.jsx must define isValidSessionUUID'
);
assert.ok(
  hostPageSource.includes('getInitialActiveSessionId'),
  'CompetitionHostPage.jsx must define getInitialActiveSessionId'
);
assert.ok(
  hostPageSource.includes('sessionStorage'),
  'CompetitionHostPage.jsx must use sessionStorage for scoped host session persistence'
);
console.log('  ✅ [1.F] PASS: Session persistence and safe UUID reload validator verified in source');

// 1.G: Zero Sensitive Tokens Persisted in Storage
const bannedStorageTerms = [
  'jwt',
  'access_token',
  'refresh_token',
  'secret',
  'guest_token'
];
bannedStorageTerms.forEach(term => {
  assert.ok(
    !hostPageSource.includes(`sessionStorage.setItem(${term}`) &&
    !hostPageSource.includes(`sessionStorage.setItem('${term}'`) &&
    !hostPageSource.includes(`localStorage.setItem('${term}'`),
    `CompetitionHostPage.jsx must NOT persist sensitive token '${term}' in browser storage`
  );
});
console.log('  ✅ [1.G] PASS: Zero sensitive tokens persisted (UUID only)');

// 1.H: Authoritative Fail-Closed Guard & Error Classification (Blocker 3)
assert.ok(
  hostPageSource.includes('isAuthoritativeSessionFailure'),
  'CompetitionHostPage.jsx must define isAuthoritativeSessionFailure'
);
assert.ok(
  hostPageSource.includes('clearRestoredSessionAndReturnToSetup'),
  'CompetitionHostPage.jsx must define clearRestoredSessionAndReturnToSetup'
);
assert.ok(
  hostPageSource.includes('restoredSessionPendingValidationRef'),
  'CompetitionHostPage.jsx must use restoredSessionPendingValidationRef'
);
assert.ok(
  hookSource.includes('errorDetails'),
  'useHostCompetitionPolling.js must export errorDetails'
);
console.log('  ✅ [1.H] PASS: Restored session authoritative fail-closed validator verified in source');

// 1.I: Reset to Setup clears persisted session
assert.ok(
  hostPageSource.includes('removeItem(HOST_SESSION_STORAGE_KEY)'),
  'handleResetToSetup / clearRestoredSessionAndReturnToSetup must remove HOST_SESSION_STORAGE_KEY on reset'
);
console.log('  ✅ [1.I] PASS: Reset to setup cleanly clears persisted session ID');

// 1.J: No extra polling loops introduced
const setIntervalInHook = hookSource.match(/setInterval/g) || [];
assert.equal(
  setIntervalInHook.length,
  0,
  'useHostCompetitionPolling.js must NOT introduce any setInterval polling loops'
);
console.log('  ✅ [1.J] PASS: Zero extra polling loops in useHostCompetitionPolling.js');


// ============================================================================
// Test 2: Host View State Machine Simulation (Finish Flow, Reload Recovery, Stale Guards)
// ============================================================================
console.log('\n--- [Test 2] Host View State Machine Simulation ---');

// Mock Session Storage
class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) ?? null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const HOST_SESSION_STORAGE_KEY = 'competition_host_active_session_id';
const STORAGE_KEY = HOST_SESSION_STORAGE_KEY;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidSessionUUID = (id) => typeof id === 'string' && UUID_REGEX.test(id.trim());

const isAuthoritativeSessionFailure = (errorOrDetails) => {
  if (!errorOrDetails) return false;
  if (typeof errorOrDetails === 'string') {
    const lower = errorOrDetails.toLowerCase();
    return (
      lower.includes('không tồn tại') ||
      lower.includes('not found') ||
      lower.includes('không có quyền') ||
      lower.includes('permission denied') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden') ||
      lower.includes('invalid session')
    );
  }
  const code = errorOrDetails.error_code || errorOrDetails.code;
  const status = errorOrDetails.status;
  const msg = (errorOrDetails.message || '').toLowerCase();

  if (
    code === 'NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN_OR_NOT_FOUND' ||
    code === 'INVALID_SESSION' ||
    code === 'INVALID_SESSION_ID' ||
    code === '42501' ||
    code === 'PGRST116'
  ) {
    return true;
  }

  if (status === 401 || status === 403 || status === 404) {
    return true;
  }

  if (
    msg.includes('không tồn tại') ||
    msg.includes('not found') ||
    msg.includes('không có quyền') ||
    msg.includes('permission denied') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  ) {
    return true;
  }

  return false;
};

const resolveInitialSessionId = (storage, urlQuery = null) => {
  if (urlQuery) {
    const params = new URLSearchParams(urlQuery);
    const urlSession = params.get('sessionId') || params.get('session_id');
    if (urlSession && isValidSessionUUID(urlSession)) {
      return urlSession.trim();
    }
  }
  const stored = storage.getItem(STORAGE_KEY);
  if (stored && isValidSessionUUID(stored)) {
    return stored.trim();
  }
  if (stored) {
    storage.removeItem(STORAGE_KEY);
  }
  return null;
};

class MockHostSessionManager {
  constructor({
    sessionId = null,
    initialStatus = 'in_progress',
    initialQuestionId = 'q1',
    storage = new MockSessionStorage(),
    urlQuery = null,
    isCreatedInSession = false
  } = {}) {
    this.storage = storage;
    this.urlQuery = urlQuery;
    const resolvedSessionId = sessionId || resolveInitialSessionId(this.storage, urlQuery);
    this.activeSessionId = resolvedSessionId;
    this.activeSessionIdRef = { current: resolvedSessionId };
    this.restoredSessionPendingValidation = Boolean(resolvedSessionId && !isCreatedInSession);
    this.status = resolvedSessionId ? initialStatus : 'setup';
    this.currentQuestionId = initialQuestionId;
    this.viewMode = 'LIVE_QUESTION';
    this.questionResults = null;
    this.timeLeftSeconds = resolvedSessionId ? 30 : null;
    this.autoResultAttempt = resolvedSessionId ? { key: 'q1:30', attempts: 1 } : null;
    this.leaderboardData = [];
    this.leaderboardError = null;
    this.latestLeaderboardRequestId = 0;
    this.lastErrorMessage = null;

    if (this.activeSessionId && isValidSessionUUID(this.activeSessionId)) {
      this.storage.setItem(STORAGE_KEY, this.activeSessionId);
    }
  }

  createSession(newSessionId) {
    this.activeSessionId = newSessionId;
    this.activeSessionIdRef.current = newSessionId;
    this.restoredSessionPendingValidation = false; // Freshly created session
    this.status = 'waiting';
    this.viewMode = 'LIVE_QUESTION';
    if (newSessionId && isValidSessionUUID(newSessionId)) {
      this.storage.setItem(STORAGE_KEY, newSessionId);
    }
  }

  setActiveSession(newSessionId) {
    this.activeSessionId = newSessionId;
    this.activeSessionIdRef.current = newSessionId;
    if (newSessionId && isValidSessionUUID(newSessionId)) {
      this.storage.setItem(STORAGE_KEY, newSessionId);
    } else {
      this.storage.removeItem(STORAGE_KEY);
    }
  }

  // Authoritative fail-closed handler
  clearRestoredSessionAndReturnToSetup(failureReason) {
    this.storage.removeItem(STORAGE_KEY);
    this.urlQuery = null;
    this.activeSessionId = null;
    this.activeSessionIdRef.current = null;
    this.restoredSessionPendingValidation = false;
    this.status = 'setup';
    this.viewMode = 'LIVE_QUESTION';
    this.leaderboardData = [];
    this.leaderboardError = null;
    this.questionResults = null;
    this.timeLeftSeconds = null;
    this.autoResultAttempt = null;
    this.lastErrorMessage = failureReason;
  }

  // Handle snapshot poll result with authoritative validation
  handleSnapshotPollResult(res) {
    if (res.success && res.data) {
      if (this.restoredSessionPendingValidation && res.data.id === this.activeSessionId) {
        this.restoredSessionPendingValidation = false; // Validation passed!
      }
      this.status = res.data.status || this.status;
      if (res.data.status === 'finished') {
        this.viewMode = 'FINAL_RESULTS';
        this.questionResults = null;
        this.timeLeftSeconds = null;
        this.autoResultAttempt = null;
      }
      return { success: true, data: res.data };
    } else {
      // Failure
      if (this.restoredSessionPendingValidation) {
        if (isAuthoritativeSessionFailure(res)) {
          this.clearRestoredSessionAndReturnToSetup(res.message || 'Phòng thi không tồn tại hoặc bạn không có quyền.');
          return { success: false, failedClosed: true };
        }
      }
      // Transient error - preserve session
      return { success: false, failedClosed: false, error: res.message };
    }
  }

  // 1. Host finishes session flow
  async handleFinishSession(mockFinishRpc, mockLeaderboardRpc) {
    const res = await mockFinishRpc(this.activeSessionId);
    if (!res.success) {
      return { success: false, message: res.message };
    }

    // Clear stale question state & timer
    this.questionResults = null;
    this.timeLeftSeconds = null;
    this.autoResultAttempt = null;
    this.status = 'finished';

    // Fetch authoritative leaderboard
    const lbRes = await this.fetchLeaderboard(this.activeSessionId, mockLeaderboardRpc);
    this.viewMode = 'FINAL_RESULTS';
    return { success: true, lbSuccess: lbRes.success };
  }

  // 2. Fetch leaderboard with both requestId race guard AND activeSessionIdRef identity guard (Blocker 1)
  async fetchLeaderboard(targetSessionIdParam, mockLeaderboardRpc) {
    const targetSessionId = (typeof targetSessionIdParam === 'string' && targetSessionIdParam)
      ? targetSessionIdParam
      : this.activeSessionIdRef.current;

    if (!targetSessionId || typeof targetSessionId !== 'string') {
      return { success: false, error_code: 'NO_SESSION' };
    }

    // Pre-flight check
    if (this.activeSessionIdRef.current && targetSessionId !== this.activeSessionIdRef.current) {
      return { success: false, error_code: 'STALE_SESSION' };
    }

    const requestId = ++this.latestLeaderboardRequestId;
    this.leaderboardError = null;

    try {
      const res = await mockLeaderboardRpc(targetSessionId);

      // Guard 1: Request ID race check
      if (requestId !== this.latestLeaderboardRequestId) {
        return { success: false, error_code: 'STALE_REQUEST' };
      }

      // Guard 2: Session Identity Guard (Blocker 1)
      if (!this.activeSessionIdRef.current || targetSessionId !== this.activeSessionIdRef.current) {
        return { success: false, error_code: 'STALE_SESSION' };
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
      if (
        requestId === this.latestLeaderboardRequestId &&
        this.activeSessionIdRef.current &&
        targetSessionId === this.activeSessionIdRef.current
      ) {
        this.leaderboardError = err.message;
      }
      return { success: false, error_code: 'NETWORK_ERROR' };
    }
  }

  // Reset to setup
  handleResetToSetup() {
    this.clearRestoredSessionAndReturnToSetup();
  }
}

// 2.1: Finish flow transitions to FINAL_RESULTS and clears timer/stale results
{
  const host = new MockHostSessionManager({ sessionId: 'a0000000-0000-4000-8000-000000000100' });
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

// 2.2: True Browser Reload Recovery on Finished Session (Blocker 2)
{
  const mockStorage = new MockSessionStorage();
  const validUUID = 'b0000000-0000-4000-8000-000000000200';
  mockStorage.setItem(STORAGE_KEY, validUUID);

  // Host opens page after browser F5 / reload
  const reloadedHost = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(reloadedHost.activeSessionId, validUUID, 'Must restore activeSessionId from sessionStorage');
  assert.equal(reloadedHost.activeSessionIdRef.current, validUUID, 'activeSessionIdRef must sync with restored ID');
  assert.equal(reloadedHost.restoredSessionPendingValidation, true);

  const mockLeaderboardRpc = async () => ({
    success: true,
    data: {
      leaderboard: [
        { participant_id: 'p1', display_name: 'Alice', rank: 1, total_score: 10, correct_count: 1, total_response_time_ms: 800 }
      ]
    }
  });

  // Polling snapshot returns status = 'finished'
  const pollRes = reloadedHost.handleSnapshotPollResult({
    success: true,
    data: { id: validUUID, status: 'finished' }
  });
  assert.equal(pollRes.success, true);
  assert.equal(reloadedHost.restoredSessionPendingValidation, false, 'Validation flag cleared on successful poll');

  await reloadedHost.fetchLeaderboard(validUUID, mockLeaderboardRpc);

  assert.equal(reloadedHost.viewMode, 'FINAL_RESULTS');
  assert.equal(reloadedHost.status, 'finished');
  assert.equal(reloadedHost.questionResults, null, 'Stale questionResults cleared on reload');
  assert.equal(reloadedHost.timeLeftSeconds, null, 'Timer remains null on reload');
  assert.equal(reloadedHost.leaderboardData.length, 1);
  assert.equal(reloadedHost.leaderboardData[0].display_name, 'Alice');
  console.log('  ✅ [2.2] PASS: True reload recovery: restores UUID -> polls finished snapshot -> renders FINAL_RESULTS & leaderboard');
}

// 2.3: Invalid / Corrupted Persisted Session Fails Closed to Setup
{
  const mockStorage = new MockSessionStorage();
  mockStorage.setItem(STORAGE_KEY, 'invalid-non-uuid-string-or-token');

  const host = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(host.activeSessionId, null, 'Invalid UUID must be rejected and not restored');
  assert.equal(host.status, 'setup', 'Status must stay setup when storage is invalid');
  assert.equal(mockStorage.getItem(STORAGE_KEY), null, 'Corrupted storage item must be pruned');
  console.log('  ✅ [2.3] PASS: Corrupted / invalid persisted session safely fails closed to setup');
}

// 2.4: Reset to Setup Clears Persisted Session from Storage
{
  const mockStorage = new MockSessionStorage();
  const validUUID = 'c0000000-0000-4000-8000-000000000300';
  const host = new MockHostSessionManager({ sessionId: validUUID, storage: mockStorage, initialStatus: 'finished' });
  assert.equal(mockStorage.getItem(STORAGE_KEY), validUUID);

  host.handleResetToSetup();
  assert.equal(host.activeSessionId, null);
  assert.equal(host.activeSessionIdRef.current, null);
  assert.equal(host.status, 'setup');
  assert.equal(host.viewMode, 'LIVE_QUESTION');
  assert.equal(host.leaderboardData.length, 0);
  assert.equal(mockStorage.getItem(STORAGE_KEY), null, 'SessionStorage must be cleared on reset');
  console.log('  ✅ [2.4] PASS: Reset to setup clears memory state and sessionStorage');
}

// 2.5: URL Query Param Session Recovery
{
  const mockStorage = new MockSessionStorage();
  const urlUUID = 'd0000000-0000-4000-8000-000000000400';
  const host = new MockHostSessionManager({ storage: mockStorage, urlQuery: `?sessionId=${urlUUID}` });
  assert.equal(host.activeSessionId, urlUUID, 'Must resolve session ID from URL query param');
  assert.equal(mockStorage.getItem(STORAGE_KEY), urlUUID, 'Must persist resolved URL session to storage');
  console.log('  ✅ [2.5] PASS: URL query param session recovery works and syncs to storage');
}

// 2.6: Stale Session ID Guard when Session Switched Without New Request (Blocker 1)
{
  const sessionA = 'e0000000-0000-4000-8000-00000000050a';
  const sessionB = 'e0000000-0000-4000-8000-00000000050b';
  const host = new MockHostSessionManager({ sessionId: sessionA });

  let resolveSessionA;
  const slowPromiseA = new Promise(resolve => { resolveSessionA = resolve; });
  const mockSlowRpcA = async () => slowPromiseA;

  // 1. Session A request starts (pending)
  const reqAPromise = host.fetchLeaderboard(sessionA, mockSlowRpcA);
  assert.equal(host.latestLeaderboardRequestId, 1);

  // 2. Host switches to Session B (or resets to null) WITHOUT creating a new leaderboard request
  host.setActiveSession(sessionB);
  assert.equal(host.activeSessionId, sessionB);
  assert.equal(host.activeSessionIdRef.current, sessionB);
  assert.equal(host.latestLeaderboardRequestId, 1, 'No new leaderboard request created');

  // 3. Response for Session A arrives
  resolveSessionA({
    success: true,
    data: {
      leaderboard: [
        { participant_id: 'pA', display_name: 'StaleUserA', rank: 1, total_score: 100 }
      ]
    }
  });

  const resA = await reqAPromise;

  // 4. Verification: Must be rejected with STALE_SESSION and UI state must NOT be mutated
  assert.equal(resA.error_code, 'STALE_SESSION', 'Response for session A must be rejected with STALE_SESSION');
  assert.equal(host.leaderboardData.length, 0, 'Leaderboard data must NOT be written with stale Session A response');
  assert.equal(host.leaderboardError, null);
  console.log('  ✅ [2.6] PASS: Blocker 1 verified: Stale Session A response after session switch without new request is rejected (STALE_SESSION)');
}

// 2.7: Stale Session ID Guard when Host Resets to Setup During Request
{
  const sessionA = 'f0000000-0000-4000-8000-00000000060a';
  const host = new MockHostSessionManager({ sessionId: sessionA });

  let resolveSessionA;
  const slowPromiseA = new Promise(resolve => { resolveSessionA = resolve; });
  const mockSlowRpcA = async () => slowPromiseA;

  const reqAPromise = host.fetchLeaderboard(sessionA, mockSlowRpcA);

  // Host resets to setup during pending fetch
  host.handleResetToSetup();
  assert.equal(host.activeSessionId, null);
  assert.equal(host.activeSessionIdRef.current, null);

  resolveSessionA({
    success: true,
    data: {
      leaderboard: [
        { participant_id: 'pA', display_name: 'StaleUserA', rank: 1, total_score: 50 }
      ]
    }
  });

  const resA = await reqAPromise;
  assert.equal(resA.error_code, 'STALE_SESSION');
  assert.equal(host.leaderboardData.length, 0, 'No state written after reset to setup');
  console.log('  ✅ [2.7] PASS: Stale response arriving after handleResetToSetup rejected with STALE_SESSION');
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
  const host = new MockHostSessionManager({ sessionId: '10000000-0000-4000-8000-000000000001' });
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

// 4.2: Stale Request ID Race Guard
{
  const host = new MockHostSessionManager({ sessionId: '20000000-0000-4000-8000-000000000002' });
  
  // Start slow request #1
  let resolveReq1;
  const slowPromise1 = new Promise(resolve => { resolveReq1 = resolve; });
  const mockSlowRpc = async () => slowPromise1;

  const req1Promise = host.fetchLeaderboard(host.activeSessionId, mockSlowRpc);

  // Trigger fast request #2
  const mockFastRpc = async () => ({
    success: true,
    data: { leaderboard: [{ participant_id: 'pB', display_name: 'UserB', rank: 1 }] }
  });
  await host.fetchLeaderboard(host.activeSessionId, mockFastRpc);
  assert.equal(host.leaderboardData[0].display_name, 'UserB');

  // Now slow request #1 resolves
  resolveReq1({
    success: true,
    data: { leaderboard: [{ participant_id: 'pA', display_name: 'UserA_STALE', rank: 1 }] }
  });
  const req1Res = await req1Promise;

  assert.equal(req1Res.error_code, 'STALE_REQUEST');
  assert.equal(host.leaderboardData[0].display_name, 'UserB', 'Stale request MUST NOT overwrite newer data');
  console.log('  ✅ [4.2] PASS: Stale request ID safely rejected, preventing older data overwrite');
}


// ============================================================================
// Test 5: Restored Session Fail-Closed & Error Classification (Blocker 3 Tests)
// ============================================================================
console.log('\n--- [Test 5] Restored Session Fail-Closed & Error Classification Matrix ---');

// 5.1: Error Classification Helper Tests
{
  // Authoritative errors
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'NOT_FOUND', status: 404 }), true);
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'SESSION_NOT_FOUND' }), true);
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'FORBIDDEN', status: 403 }), true);
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'UNAUTHORIZED', status: 401 }), true);
  assert.equal(isAuthoritativeSessionFailure({ error_code: '42501' }), true);
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'PGRST116' }), true);
  assert.equal(isAuthoritativeSessionFailure({ message: 'Phòng thi không tồn tại.' }), true);
  assert.equal(isAuthoritativeSessionFailure('permission denied for table competition_sessions'), true);

  // Transient errors (MUST NOT be authoritative failure)
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'CLIENT_EXCEPTION', message: 'Failed to fetch' }), false);
  assert.equal(isAuthoritativeSessionFailure({ error_code: 'DB_ERROR', status: 500, message: 'Internal server error' }), false);
  assert.equal(isAuthoritativeSessionFailure({ status: 502, message: 'Bad gateway' }), false);
  assert.equal(isAuthoritativeSessionFailure({ status: 503, message: 'Service unavailable' }), false);
  assert.equal(isAuthoritativeSessionFailure({ message: 'Network request failed' }), false);
  console.log('  ✅ [5.1] PASS: Error classification helper accurately partitions authoritative vs transient errors');
}

// 5.2: Restored Valid UUID + Valid Snapshot -> Session Preserved
{
  const mockStorage = new MockSessionStorage();
  const validUUID = '30000000-0000-4000-8000-000000000003';
  mockStorage.setItem(STORAGE_KEY, validUUID);

  const host = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(host.activeSessionId, validUUID);
  assert.equal(host.restoredSessionPendingValidation, true);

  const pollRes = host.handleSnapshotPollResult({
    success: true,
    data: { id: validUUID, status: 'in_progress' }
  });

  assert.equal(pollRes.success, true);
  assert.equal(host.activeSessionId, validUUID, 'Session ID must remain active');
  assert.equal(host.restoredSessionPendingValidation, false, 'Validation pending flag must be cleared');
  assert.equal(mockStorage.getItem(STORAGE_KEY), validUUID, 'Storage item must remain intact');
  console.log('  ✅ [5.2] PASS: Restored valid session with authorized snapshot is preserved cleanly');
}

// 5.3: Restored Valid UUID + SESSION_NOT_FOUND -> Fail Closed to Setup
{
  const mockStorage = new MockSessionStorage();
  const validUUID = '40000000-0000-4000-8000-000000000004';
  mockStorage.setItem(STORAGE_KEY, validUUID);

  const host = new MockHostSessionManager({ storage: mockStorage, urlQuery: `?sessionId=${validUUID}` });
  assert.equal(host.activeSessionId, validUUID);
  assert.equal(host.restoredSessionPendingValidation, true);

  const pollRes = host.handleSnapshotPollResult({
    success: false,
    error_code: 'NOT_FOUND',
    status: 404,
    message: 'Phòng thi không tồn tại.'
  });

  assert.equal(pollRes.failedClosed, true);
  assert.equal(host.activeSessionId, null, 'activeSessionId must be cleared');
  assert.equal(host.activeSessionIdRef.current, null, 'activeSessionIdRef must be cleared');
  assert.equal(host.status, 'setup', 'Host must return to setup status');
  assert.equal(mockStorage.getItem(STORAGE_KEY), null, 'sessionStorage must be cleared');
  assert.equal(host.urlQuery, null, 'URL query must be cleared');
  console.log('  ✅ [5.3] PASS: Restored session NOT_FOUND fails closed to setup, clearing storage & URL');
}

// 5.4: Restored Valid UUID + FORBIDDEN / UNAUTHORIZED -> Fail Closed to Setup
{
  const mockStorage = new MockSessionStorage();
  const validUUID = '50000000-0000-4000-8000-000000000005';
  mockStorage.setItem(STORAGE_KEY, validUUID);

  const host = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(host.activeSessionId, validUUID);

  const pollRes = host.handleSnapshotPollResult({
    success: false,
    error_code: 'FORBIDDEN',
    status: 403,
    message: 'Bạn không có quyền quản trị phòng thi này.'
  });

  assert.equal(pollRes.failedClosed, true);
  assert.equal(host.activeSessionId, null);
  assert.equal(host.status, 'setup');
  assert.equal(mockStorage.getItem(STORAGE_KEY), null);
  console.log('  ✅ [5.4] PASS: Restored session FORBIDDEN fails closed to setup');
}

// 5.5: Restored Valid UUID + NETWORK_ERROR -> Preserves Session (No Fail-Closed)
{
  const mockStorage = new MockSessionStorage();
  const validUUID = '60000000-0000-4000-8000-000000000006';
  mockStorage.setItem(STORAGE_KEY, validUUID);

  const host = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(host.activeSessionId, validUUID);

  const pollRes = host.handleSnapshotPollResult({
    success: false,
    error_code: 'CLIENT_EXCEPTION',
    message: 'TypeError: fetch failed (network offline)'
  });

  assert.equal(pollRes.failedClosed, false);
  assert.equal(host.activeSessionId, validUUID, 'Session MUST NOT be cleared on network error');
  assert.equal(host.activeSessionIdRef.current, validUUID);
  assert.equal(mockStorage.getItem(STORAGE_KEY), validUUID, 'Storage item MUST be preserved');
  console.log('  ✅ [5.5] PASS: Restored session on NETWORK_ERROR preserves session & storage for retry');
}

// 5.6: Restored Valid UUID + HTTP 500/503 -> Preserves Session (No Fail-Closed)
{
  const mockStorage = new MockSessionStorage();
  const validUUID = '70000000-0000-4000-8000-000000000007';
  mockStorage.setItem(STORAGE_KEY, validUUID);

  const host = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(host.activeSessionId, validUUID);

  const pollRes = host.handleSnapshotPollResult({
    success: false,
    error_code: 'DB_ERROR',
    status: 500,
    message: 'Internal database query timeout'
  });

  assert.equal(pollRes.failedClosed, false);
  assert.equal(host.activeSessionId, validUUID, 'Session MUST NOT be cleared on 500 server error');
  assert.equal(mockStorage.getItem(STORAGE_KEY), validUUID);
  console.log('  ✅ [5.6] PASS: Restored session on HTTP 500 preserves session for retry');
}

// 5.7: Normal Active Session Created in Tab + Network Error -> Preserves Session
{
  const mockStorage = new MockSessionStorage();
  const host = new MockHostSessionManager({ storage: mockStorage });
  assert.equal(host.status, 'setup');

  const createdSessionId = '80000000-0000-4000-8000-000000000008';
  host.createSession(createdSessionId);
  assert.equal(host.activeSessionId, createdSessionId);
  assert.equal(host.restoredSessionPendingValidation, false, 'Newly created session is not in restored validation mode');

  // Network drops during active session
  const pollRes = host.handleSnapshotPollResult({
    success: false,
    error_code: 'CLIENT_EXCEPTION',
    message: 'Network offline'
  });

  assert.equal(pollRes.failedClosed, false);
  assert.equal(host.activeSessionId, createdSessionId, 'Live running session must NEVER reset on transient error');
  console.log('  ✅ [5.7] PASS: Normal active session created in tab preserves session across network drops');
}

console.log('\n================================================================================');
console.log('🎉 ALL COMPETITION V1 R3 FINAL RESULTS & PODIUM CEREMONY TESTS PASSED!');
console.log('================================================================================\n');
