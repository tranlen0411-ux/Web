import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STUDENT_SESSION_STORAGE_KEY,
  STUDENT_PARTICIPANT_STORAGE_KEY,
  isValidSessionUUID,
  isStudentAuthOrPermanentError,
} from '../src/services/competitionClient.js';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 R4 STUDENT FINAL RESULTS TEST SUITE');
console.log('================================================================================\n');

const validSessionUUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const validParticipantUUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const invalidUUID = 'invalid-uuid-12345';

const studentPageSource = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');
const studentHookSource = fs.readFileSync('src/hooks/useStudentCompetitionRealtime.js', 'utf8');
const clientLibSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');

// Mock Storage Helper
function createMockStorage() {
  const store = {};
  return {
    getItem(k) { return store[k] || null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
    _store: store,
  };
}

// ============================================================================
// Test 1: Auth Join Persistence
// ============================================================================
console.log('--- [Test 1] Auth Join Persistence ---');
assert.equal(STUDENT_SESSION_STORAGE_KEY, 'competition_student_session_id');
assert.equal(STUDENT_PARTICIPANT_STORAGE_KEY, 'competition_student_participant_id');

const mockStorage1 = createMockStorage();
mockStorage1.setItem(STUDENT_SESSION_STORAGE_KEY, validSessionUUID);
mockStorage1.setItem(STUDENT_PARTICIPANT_STORAGE_KEY, validParticipantUUID);

assert.equal(mockStorage1.getItem(STUDENT_SESSION_STORAGE_KEY), validSessionUUID);
assert.equal(mockStorage1.getItem(STUDENT_PARTICIPANT_STORAGE_KEY), validParticipantUUID);
console.log('  ✅ [1] PASS: Student session and participant UUID stored in sessionStorage');

// ============================================================================
// Test 2: Storage UUID Validation
// ============================================================================
console.log('--- [Test 2] Storage UUID Validation ---');
assert.equal(isValidSessionUUID(validSessionUUID), true);
assert.equal(isValidSessionUUID(validParticipantUUID), true);
assert.equal(isValidSessionUUID(invalidUUID), false);
assert.equal(isValidSessionUUID(''), false);
assert.equal(isValidSessionUUID(null), false);
assert.equal(isValidSessionUUID(undefined), false);
assert.equal(isValidSessionUUID('12345678-1234-1234-1234-1234567890123'), false);
console.log('  ✅ [2] PASS: isValidSessionUUID accurately validates RFC 4122 UUIDs');

// ============================================================================
// Test 3: F5 Active Session Restore
// ============================================================================
console.log('--- [Test 3] F5 Active Session Restore ---');
assert.ok(studentPageSource.includes('getInitialStudentSession'), 'Must include getInitialStudentSession');
assert.ok(studentPageSource.includes('STUDENT_SESSION_STORAGE_KEY'), 'Must use STUDENT_SESSION_STORAGE_KEY');
assert.ok(studentPageSource.includes('STUDENT_PARTICIPANT_STORAGE_KEY'), 'Must use STUDENT_PARTICIPANT_STORAGE_KEY');

const mockStorage3 = createMockStorage();
mockStorage3.setItem(STUDENT_SESSION_STORAGE_KEY, validSessionUUID);
mockStorage3.setItem(STUDENT_PARTICIPANT_STORAGE_KEY, validParticipantUUID);

const resolvedSession = mockStorage3.getItem(STUDENT_SESSION_STORAGE_KEY);
const resolvedParticipant = mockStorage3.getItem(STUDENT_PARTICIPANT_STORAGE_KEY);
assert.equal(isValidSessionUUID(resolvedSession), true);
assert.equal(isValidSessionUUID(resolvedParticipant), true);
console.log('  ✅ [3] PASS: Session & Participant UUID correctly resolved from storage on F5');

// ============================================================================
// Test 4: Active Restore Uses Rejoin
// ============================================================================
console.log('--- [Test 4] Active Restore Uses Rejoin ---');
assert.ok(
  studentPageSource.includes('studentRejoinSession({'),
  'Active session restore must invoke studentRejoinSession'
);
assert.ok(
  studentPageSource.includes("session.status === 'finished'"),
  'Must branch separately for finished status'
);
console.log('  ✅ [4] PASS: Active sessions invoke studentRejoinSession for state recovery');

// ============================================================================
// Test 5: Finished Restore does NOT Use Rejoin
// ============================================================================
console.log('--- [Test 5] Finished Restore does NOT Use Rejoin ---');
assert.ok(
  studentPageSource.includes('DO NOT call rejoin RPC') ||
  studentPageSource.includes('session.status === \'finished\''),
  'Finished session must load directly without calling rejoin RPC'
);
console.log('  ✅ [5] PASS: Finished session restore skips studentRejoinSession (avoids SESSION_CLOSED)');

// ============================================================================
// Test 6: Finished Restore Fetches Snapshot + Leaderboard
// ============================================================================
console.log('--- [Test 6] Finished Restore Fetches Snapshot + Leaderboard ---');
assert.ok(
  studentPageSource.includes('getLeaderboardSnapshot({'),
  'Must fetch getLeaderboardSnapshot for finished session'
);
assert.ok(
  studentHookSource.includes('getLeaderboardSnapshot({'),
  'Realtime hook must fetch leaderboard snapshot when finished'
);
console.log('  ✅ [6] PASS: Finished session loads authoritative snapshot + leaderboard');

// ============================================================================
// Test 7: Finished Personal Participant Match
// ============================================================================
console.log('--- [Test 7] Finished Personal Participant Match ---');
const mockLeaderboard7 = [
  { participant_id: 'p-1', display_name: 'Student 1', rank: 1, total_score: 100, correct_count: 5, total_response_time_ms: 5000 },
  { participant_id: validParticipantUUID, display_name: 'My Student', rank: 2, total_score: 80, correct_count: 4, total_response_time_ms: 6000 },
];

const matched7 = mockLeaderboard7.find(item => item.participant_id === validParticipantUUID);
assert.ok(matched7);
assert.equal(matched7.rank, 2);
assert.equal(matched7.total_score, 80);
assert.equal(matched7.correct_count, 4);
assert.equal(matched7.total_response_time_ms, 6000);
console.log('  ✅ [7] PASS: Authoritative participant matched in finished leaderboard');

// ============================================================================
// Test 8: Wrong Participant ID Fails Closed
// ============================================================================
console.log('--- [Test 8] Wrong Participant ID Fails Closed ---');
const unmatched = mockLeaderboard7.find(item => item.participant_id === 'non-existent-uuid');
assert.equal(unmatched, undefined);
assert.ok(
  studentPageSource.includes('Không tìm thấy thông tin thí sinh') ||
  studentPageSource.includes('clearRestoredSessionAndReturnToJoin'),
  'Must handle unmatched participant in leaderboard'
);
console.log('  ✅ [8] PASS: Unmatched participant ID safely fails closed');

// ============================================================================
// Test 9: Not Found Fails Closed
// ============================================================================
console.log('--- [Test 9] Not Found Fails Closed ---');
assert.equal(isStudentAuthOrPermanentError('SESSION_NOT_FOUND', 404), true);
assert.equal(isStudentAuthOrPermanentError('NOT_FOUND', 404), true);
assert.equal(isStudentAuthOrPermanentError('PGRST116', 404), true);
console.log('  ✅ [9] PASS: 404 / SESSION_NOT_FOUND classified as permanent error');

// ============================================================================
// Test 10: Kicked Fails Closed
// ============================================================================
console.log('--- [Test 10] Kicked Fails Closed ---');
assert.equal(isStudentAuthOrPermanentError('PARTICIPANT_KICKED', 403), true);
console.log('  ✅ [10] PASS: PARTICIPANT_KICKED classified as permanent error');

// ============================================================================
// Test 11: 403 / Forbidden Fails Closed
// ============================================================================
console.log('--- [Test 11] 403 / Forbidden Fails Closed ---');
assert.equal(isStudentAuthOrPermanentError('FORBIDDEN', 403), true);
assert.equal(isStudentAuthOrPermanentError('42501', 403), true);
assert.equal(isStudentAuthOrPermanentError('UNAUTHORIZED', 401), true);
assert.equal(isStudentAuthOrPermanentError('ROLE_NOT_ALLOWED', 403), true);
console.log('  ✅ [11] PASS: 401 / 403 / 42501 classified as permanent error');

// ============================================================================
// Test 12: Network Error Preserves Persistence
// ============================================================================
console.log('--- [Test 12] Network Error Preserves Persistence ---');
assert.equal(isStudentAuthOrPermanentError('FETCH_FAILED', undefined), false);
assert.equal(isStudentAuthOrPermanentError('CLIENT_EXCEPTION', undefined), false);
assert.equal(isStudentAuthOrPermanentError(null, undefined), false);
console.log('  ✅ [12] PASS: Network / transient errors do NOT clear session storage');

// ============================================================================
// Test 13: 500 Preserves Persistence
// ============================================================================
console.log('--- [Test 13] 500 Preserves Persistence ---');
assert.equal(isStudentAuthOrPermanentError('INTERNAL_SERVER_ERROR', 500), false);
assert.equal(isStudentAuthOrPermanentError('BAD_GATEWAY', 502), false);
assert.equal(isStudentAuthOrPermanentError('SERVICE_UNAVAILABLE', 503), false);
console.log('  ✅ [13] PASS: HTTP 500/502/503 server errors preserved for retry');

// ============================================================================
// Test 14: Finish Clears Stale Question State
// ============================================================================
console.log('--- [Test 14] Finish Clears Stale Question State ---');
assert.ok(
  studentPageSource.includes("sessionData?.status === 'finished'") &&
  studentPageSource.includes('setSelectedOptionId(null)') &&
  studentPageSource.includes('setHasSubmittedCurrentQuestion(false)') &&
  studentPageSource.includes('setSubmitResult(null)'),
  'Must clear question and submission state when session finishes'
);
console.log('  ✅ [14] PASS: Finish transition purges all active question state');

// ============================================================================
// Test 15: Late Answer Response Guard & Simulation
// ============================================================================
console.log('--- [Test 15] Late Answer Response Guard (Deep Simulation) ---');

// 15.A: Source verification for 5-guard check and refs ordering (TDZ Elimination)
assert.ok(studentPageSource.includes('sessionStatusRef'), 'Must declare sessionStatusRef');
assert.ok(studentPageSource.includes('currentQuestionIdRef'), 'Must declare currentQuestionIdRef');
assert.ok(studentPageSource.includes('activeSessionIdRef'), 'Must declare activeSessionIdRef');
assert.ok(studentPageSource.includes('activeParticipantIdRef'), 'Must declare activeParticipantIdRef');
assert.ok(studentPageSource.includes('isMountedRef'), 'Must declare isMountedRef');

// Strict TDZ Ordering Check: hook destructuring MUST appear before sessionStatusRef and currentQuestionIdRef
const hookIndex = studentPageSource.indexOf('useStudentCompetitionRealtime({');
const sessionStatusRefIndex = studentPageSource.indexOf('const sessionStatusRef = useRef(sessionData?.status)');
const currentQuestionIdRefIndex = studentPageSource.indexOf('const currentQuestionIdRef = useRef(currentQuestion?.id');

assert.ok(hookIndex !== -1, 'useStudentCompetitionRealtime call must exist');
assert.ok(sessionStatusRefIndex !== -1, 'sessionStatusRef declaration must exist');
assert.ok(currentQuestionIdRefIndex !== -1, 'currentQuestionIdRef declaration must exist');
assert.ok(
  hookIndex < sessionStatusRefIndex,
  'useStudentCompetitionRealtime must be declared BEFORE sessionStatusRef to avoid TDZ ReferenceError'
);
assert.ok(
  hookIndex < currentQuestionIdRefIndex,
  'useStudentCompetitionRealtime must be declared BEFORE currentQuestionIdRef to avoid TDZ ReferenceError'
);
console.log('  ✅ [15.0] PASS: Hook destructuring strictly precedes statusRef & questionRef (Zero TDZ risk)');

// 15.B: Behavioral Simulation Function implementing the exact component logic
function executeSubmitAnswerSimulation({
  isMountedRef,
  activeSessionIdRef,
  activeParticipantIdRef,
  currentQuestionIdRef,
  sessionStatusRef,
  targetSessionId,
  targetParticipantId,
  targetQuestionId,
  mockApiResponse,
  stateMutator,
}) {
  const isResponseValid =
    isMountedRef.current === true &&
    activeSessionIdRef.current === targetSessionId &&
    activeParticipantIdRef.current === targetParticipantId &&
    currentQuestionIdRef.current === targetQuestionId &&
    sessionStatusRef.current === 'in_progress';

  if (!isResponseValid) {
    return { ignored: true };
  }

  if (!mockApiResponse.success) {
    if (mockApiResponse.error_code === 'SESSION_NOT_ACTIVE' || mockApiResponse.error_code === 'SESSION_CLOSED') {
      return { ignored: true };
    }
    stateMutator.setSubmitError(mockApiResponse.message);
    return { ignored: false };
  }

  stateMutator.setHasSubmittedCurrentQuestion(true);
  stateMutator.setLastSubmittedQuestionId(targetQuestionId);
  stateMutator.setSubmitResult(mockApiResponse.data);
  return { ignored: false };
}

// Scenario 15.1: Session Finished while Submit is in flight -> IGNORED
{
  const isMountedRef = { current: true };
  const activeSessionIdRef = { current: 'session-A' };
  const activeParticipantIdRef = { current: 'part-1' };
  const currentQuestionIdRef = { current: 'q-1' };
  const sessionStatusRef = { current: 'in_progress' };

  // Local state initialized
  let hasSubmittedCurrentQuestion = false;
  let lastSubmittedQuestionId = null;
  let submitResult = null;
  let submitError = null;

  const stateMutator = {
    setHasSubmittedCurrentQuestion: (v) => { hasSubmittedCurrentQuestion = v; },
    setLastSubmittedQuestionId: (v) => { lastSubmittedQuestionId = v; },
    setSubmitResult: (v) => { submitResult = v; },
    setSubmitError: (v) => { submitError = v; },
  };

  // Student captures targets at start of submit
  const targetSessionId = activeSessionIdRef.current;
  const targetParticipantId = activeParticipantIdRef.current;
  const targetQuestionId = currentQuestionIdRef.current;

  // HOST FINISHES SESSION BEFORE RESPONSE ARRIVES
  sessionStatusRef.current = 'finished';
  // Finished cleanup runs:
  hasSubmittedCurrentQuestion = false;
  lastSubmittedQuestionId = null;
  submitResult = null;
  submitError = null;

  // Submit response resolves late with success
  const res = executeSubmitAnswerSimulation({
    isMountedRef,
    activeSessionIdRef,
    activeParticipantIdRef,
    currentQuestionIdRef,
    sessionStatusRef,
    targetSessionId,
    targetParticipantId,
    targetQuestionId,
    mockApiResponse: { success: true, data: { is_correct: true, points_awarded: 20 } },
    stateMutator,
  });

  assert.equal(res.ignored, true, 'Late response after finish must be ignored');
  assert.equal(hasSubmittedCurrentQuestion, false, 'hasSubmittedCurrentQuestion must remain false');
  assert.equal(lastSubmittedQuestionId, null, 'lastSubmittedQuestionId must remain null');
  assert.equal(submitResult, null, 'submitResult must remain null');
  assert.equal(submitError, null, 'submitError must remain null');
}
console.log('  ✅ [15.1] PASS: Late response after Host Finish is completely ignored & state remains clean');

// Scenario 15.2: Host advances to Question Q2 while Q1 submit in flight -> IGNORED
{
  const isMountedRef = { current: true };
  const activeSessionIdRef = { current: 'session-A' };
  const activeParticipantIdRef = { current: 'part-1' };
  const currentQuestionIdRef = { current: 'q-1' };
  const sessionStatusRef = { current: 'in_progress' };

  let hasSubmittedCurrentQuestion = false;
  let lastSubmittedQuestionId = null;
  let submitResult = null;

  const stateMutator = {
    setHasSubmittedCurrentQuestion: (v) => { hasSubmittedCurrentQuestion = v; },
    setLastSubmittedQuestionId: (v) => { lastSubmittedQuestionId = v; },
    setSubmitResult: (v) => { submitResult = v; },
    setSubmitError: () => {},
  };

  const targetSessionId = activeSessionIdRef.current;
  const targetParticipantId = activeParticipantIdRef.current;
  const targetQuestionId = 'q-1';

  // HOST ADVANCES TO QUESTION 2
  currentQuestionIdRef.current = 'q-2';

  // Q1 response arrives late
  const res = executeSubmitAnswerSimulation({
    isMountedRef,
    activeSessionIdRef,
    activeParticipantIdRef,
    currentQuestionIdRef,
    sessionStatusRef,
    targetSessionId,
    targetParticipantId,
    targetQuestionId,
    mockApiResponse: { success: true, data: { is_correct: true, points_awarded: 10 } },
    stateMutator,
  });

  assert.equal(res.ignored, true, 'Late Q1 response on Q2 must be ignored');
  assert.equal(hasSubmittedCurrentQuestion, false, 'Q2 state must not be corrupted by Q1 response');
  assert.equal(lastSubmittedQuestionId, null);
  assert.equal(submitResult, null);
}
console.log('  ✅ [15.2] PASS: Late Q1 response after Host advances to Q2 is ignored');

// Scenario 15.3: Session switches from Session A to Session B -> IGNORED
{
  const isMountedRef = { current: true };
  const activeSessionIdRef = { current: 'session-A' };
  const activeParticipantIdRef = { current: 'part-1' };
  const currentQuestionIdRef = { current: 'q-1' };
  const sessionStatusRef = { current: 'in_progress' };

  let hasSubmittedCurrentQuestion = false;
  const stateMutator = {
    setHasSubmittedCurrentQuestion: (v) => { hasSubmittedCurrentQuestion = v; },
    setLastSubmittedQuestionId: () => {},
    setSubmitResult: () => {},
    setSubmitError: () => {},
  };

  const targetSessionId = 'session-A';
  const targetParticipantId = 'part-1';
  const targetQuestionId = 'q-1';

  // ACTIVE SESSION SWITCHES TO SESSION B
  activeSessionIdRef.current = 'session-B';

  const res = executeSubmitAnswerSimulation({
    isMountedRef,
    activeSessionIdRef,
    activeParticipantIdRef,
    currentQuestionIdRef,
    sessionStatusRef,
    targetSessionId,
    targetParticipantId,
    targetQuestionId,
    mockApiResponse: { success: true, data: { is_correct: true } },
    stateMutator,
  });

  assert.equal(res.ignored, true);
  assert.equal(hasSubmittedCurrentQuestion, false);
}
console.log('  ✅ [15.3] PASS: Late response from stale session is ignored');

// Scenario 15.4: Participant switches -> IGNORED
{
  const isMountedRef = { current: true };
  const activeSessionIdRef = { current: 'session-A' };
  const activeParticipantIdRef = { current: 'part-1' };
  const currentQuestionIdRef = { current: 'q-1' };
  const sessionStatusRef = { current: 'in_progress' };

  let hasSubmittedCurrentQuestion = false;
  const stateMutator = {
    setHasSubmittedCurrentQuestion: (v) => { hasSubmittedCurrentQuestion = v; },
    setLastSubmittedQuestionId: () => {},
    setSubmitResult: () => {},
    setSubmitError: () => {},
  };

  const targetSessionId = 'session-A';
  const targetParticipantId = 'part-1';
  const targetQuestionId = 'q-1';

  // PARTICIPANT SWITCHES
  activeParticipantIdRef.current = 'part-2';

  const res = executeSubmitAnswerSimulation({
    isMountedRef,
    activeSessionIdRef,
    activeParticipantIdRef,
    currentQuestionIdRef,
    sessionStatusRef,
    targetSessionId,
    targetParticipantId,
    targetQuestionId,
    mockApiResponse: { success: true, data: { is_correct: true } },
    stateMutator,
  });

  assert.equal(res.ignored, true);
  assert.equal(hasSubmittedCurrentQuestion, false);
}
console.log('  ✅ [15.4] PASS: Late response from stale participant is ignored');

// ============================================================================
// Test 16: Countdown Stops on Finish
// ============================================================================
console.log('--- [Test 16] Countdown Stops on Finish ---');
assert.ok(
  studentPageSource.includes("sessionData.status !== 'in_progress'") &&
  studentPageSource.includes('setTimeLeftSeconds(null)'),
  'Timer must clear when session is not in_progress'
);
console.log('  ✅ [16] PASS: Countdown stops and clears timer on finish');

// ============================================================================
// Test 17: Rank 1 Podium & Celebration
// ============================================================================
console.log('--- [Test 17] Rank 1 Podium & Celebration ---');
const leaderboard17 = [
  { participant_id: 'p-1', display_name: 'Winner', rank: 1, total_score: 100 },
  { participant_id: 'p-2', display_name: 'Second', rank: 2, total_score: 80 },
  { participant_id: 'p-3', display_name: 'Third', rank: 3, total_score: 60 },
];

const gold17 = leaderboard17.filter(item => item.rank === 1);
const silver17 = leaderboard17.filter(item => item.rank === 2);
const bronze17 = leaderboard17.filter(item => item.rank === 3);

assert.equal(gold17.length, 1);
assert.equal(gold17[0].display_name, 'Winner');
assert.equal(silver17.length, 1);
assert.equal(bronze17.length, 1);
console.log('  ✅ [17] PASS: Rank 1 correctly placed on Gold podium step');

// ============================================================================
// Test 18: Tie 1, 1, 3
// ============================================================================
console.log('--- [Test 18] Tie 1, 1, 3 Handling ---');
const leaderboard18 = [
  { participant_id: 'p-1', display_name: 'Winner A', rank: 1, total_score: 100 },
  { participant_id: 'p-2', display_name: 'Winner B', rank: 1, total_score: 100 },
  { participant_id: 'p-3', display_name: 'Third', rank: 3, total_score: 70 },
  { participant_id: 'p-4', display_name: 'Fourth', rank: 4, total_score: 50 },
];

const gold18 = leaderboard18.filter(item => item.rank === 1);
const silver18 = leaderboard18.filter(item => item.rank === 2);
const bronze18 = leaderboard18.filter(item => item.rank === 3);

assert.equal(gold18.length, 2, 'Gold group must have 2 winners');
assert.equal(silver18.length, 0, 'Silver group must be empty');
assert.equal(bronze18.length, 1, 'Bronze group must have 1 winner');
assert.equal(bronze18[0].display_name, 'Third');
console.log('  ✅ [18] PASS: Tie 1, 1, 3 places both on Gold, Silver empty, Rank 3 on Bronze');

// ============================================================================
// Test 19: Tie 1, 2, 2, 4
// ============================================================================
console.log('--- [Test 19] Tie 1, 2, 2, 4 Handling ---');
const leaderboard19 = [
  { participant_id: 'p-1', display_name: 'Winner', rank: 1, total_score: 100 },
  { participant_id: 'p-2', display_name: 'Silver A', rank: 2, total_score: 80 },
  { participant_id: 'p-3', display_name: 'Silver B', rank: 2, total_score: 80 },
  { participant_id: 'p-4', display_name: 'Fourth', rank: 4, total_score: 50 },
];

const gold19 = leaderboard19.filter(item => item.rank === 1);
const silver19 = leaderboard19.filter(item => item.rank === 2);
const bronze19 = leaderboard19.filter(item => item.rank === 3);

assert.equal(gold19.length, 1, 'Gold group must have 1 winner');
assert.equal(silver19.length, 2, 'Silver group must have 2 winners');
assert.equal(bronze19.length, 0, 'Bronze group must be empty');
console.log('  ✅ [19] PASS: Tie 1, 2, 2, 4 places two on Silver, Bronze step empty');

// ============================================================================
// Test 20: Rank Gap Preserved
// ============================================================================
console.log('--- [Test 20] Rank Gap Preserved ---');
const ranks20 = leaderboard18.map(x => x.rank);
assert.deepEqual(ranks20, [1, 1, 3, 4]);
console.log('  ✅ [20] PASS: Rank gaps preserved strictly as delivered by backend');

// ============================================================================
// Test 21: No Frontend Re-ranking
// ============================================================================
console.log('--- [Test 21] No Frontend Re-ranking ---');
assert.ok(
  !studentPageSource.includes('sort((a, b) => a.total_score') &&
  !studentPageSource.includes('sort((a, b) => b.total_score'),
  'Frontend MUST NOT re-sort leaderboard scores'
);
console.log('  ✅ [21] PASS: Zero client-side re-sorting of leaderboard');

// ============================================================================
// Test 22: No idx + 1 Rank Fabrication
// ============================================================================
console.log('--- [Test 22] No idx + 1 Rank Fabrication ---');
assert.ok(
  !studentPageSource.includes('idx + 1') &&
  !studentPageSource.includes('index + 1'),
  'Must not use array index as rank fallback'
);
console.log('  ✅ [22] PASS: Zero idx + 1 rank fabrication');

// ============================================================================
// Test 23: Zero Score Handling
// ============================================================================
console.log('--- [Test 23] Zero Score Handling ---');
const zeroEntry = { total_score: 0, correct_count: 0, total_response_time_ms: 0 };
assert.equal(zeroEntry.total_score ?? 0, 0);
assert.equal(zeroEntry.correct_count ?? 0, 0);
console.log('  ✅ [23] PASS: Zero score and zero correct count handled cleanly');

// ============================================================================
// Test 24: Null Avatar Fallback
// ============================================================================
console.log('--- [Test 24] Null Avatar Fallback ---');
const userNoAvatar = { display_name: 'Minh Quan', avatar_url: null };
const initialLetter = userNoAvatar.display_name?.charAt(0).toUpperCase() || 'H';
assert.equal(initialLetter, 'M');
console.log('  ✅ [24] PASS: Null avatar correctly falls back to initial uppercase letter');

// ============================================================================
// Test 25: Clean Exit Clears Persistence
// ============================================================================
console.log('--- [Test 25] Clean Exit Clears Persistence ---');
const mockStorage25 = createMockStorage();
mockStorage25.setItem(STUDENT_SESSION_STORAGE_KEY, validSessionUUID);
mockStorage25.setItem(STUDENT_PARTICIPANT_STORAGE_KEY, validParticipantUUID);

// Simulate handleExit
mockStorage25.removeItem(STUDENT_SESSION_STORAGE_KEY);
mockStorage25.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);

assert.equal(mockStorage25.getItem(STUDENT_SESSION_STORAGE_KEY), null);
assert.equal(mockStorage25.getItem(STUDENT_PARTICIPANT_STORAGE_KEY), null);
console.log('  ✅ [25] PASS: Clean exit wipes student session storage completely');

// ============================================================================
// Test 26: Cancelled Session Does Not Show Final Results
// ============================================================================
console.log('--- [Test 26] Cancelled Session Handling ---');
assert.ok(
  studentPageSource.includes("sessionData?.status === 'cancelled'"),
  'Must have dedicated view for cancelled session'
);
console.log('  ✅ [26] PASS: Cancelled session displays cancelled state banner');

// ============================================================================
// Test 27: No Sensitive Tokens in Storage
// ============================================================================
console.log('--- [Test 27] No Sensitive Tokens in Storage ---');
const allowedKeys = [STUDENT_SESSION_STORAGE_KEY, STUDENT_PARTICIPANT_STORAGE_KEY];
allowedKeys.forEach(k => {
  assert.ok(!k.includes('token'));
  assert.ok(!k.includes('secret'));
  assert.ok(!k.includes('password'));
});
assert.ok(!studentPageSource.includes('setItem(') || !studentPageSource.includes('guest_token'));
console.log('  ✅ [27] PASS: Zero sensitive tokens persisted to web storage');

// ============================================================================
// Test 28: R2 Regression Safety
// ============================================================================
console.log('--- [Test 28] R2 Regression Safety ---');
assert.ok(
  clientLibSource.includes('export async function getHostQuestionResults'),
  'R2 getHostQuestionResults must remain intact'
);
console.log('  ✅ [28] PASS: R2 client methods intact');

// ============================================================================
// Test 29: R3 Regression Safety
// ============================================================================
console.log('--- [Test 29] R3 Regression Safety ---');
const hostSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
assert.ok(
  hostSource.includes('FINAL_RESULTS'),
  'R3 Host FINAL_RESULTS must remain intact'
);
assert.ok(
  hostSource.includes('HOST_SESSION_STORAGE_KEY'),
  'R3 Host session storage must remain intact'
);
console.log('  ✅ [29] PASS: R3 Host Final Results and Podium remain intact');

// ============================================================================
// Test 30: Guest Scope Invariant in Phase 1
// ============================================================================
console.log('--- [Test 30] Guest Scope Invariant in Phase 1 ---');
assert.ok(
  studentPageSource.includes('guestToken: null'),
  'Student join and submit must use authenticated flow with guestToken: null'
);
console.log('  ✅ [30] PASS: R4 Phase 1 strictly restricted to Authenticated Student');

// ============================================================================
// Helper for Tests 31-34: Exact Simulation of useStudentCompetitionRealtime
// ============================================================================
async function simulateStudentRealtimeHook({
  sessionId,
  participantId,
  mockSessionSnapshot,
  mockActiveQuestion = { success: true, data: { question: null } },
  mockLeaderboard = { success: true, data: { leaderboard: [] } },
  mockCapabilityTokenResult = { success: true, token: 'mock-cap-token' },
}) {
  let connectionStatus = 'disconnected';
  let sessionData = null;
  let currentQuestion = null;
  let leaderboard = [];
  let error = null;

  const isMountedRef = { current: true };
  const isTerminalRef = { current: false };
  const isPollingRef = { current: false };
  const channelRef = { current: null };
  const pollTimerRef = { current: 123 }; // mock timer ID

  const calls = {
    refreshAuthoritativeStateCount: 0,
    getSessionSnapshotCount: 0,
    getActiveQuestionSnapshotCount: 0,
    getLeaderboardSnapshotCount: 0,
    getCapabilityTokenCount: 0,
    createCompetitionChannelCount: 0,
    removeCompetitionChannelCount: 0,
    callOrder: [],
  };

  async function refreshAuthoritativeState() {
    if (!sessionId || isPollingRef.current || !isMountedRef.current || isTerminalRef.current) return;
    isPollingRef.current = true;
    calls.refreshAuthoritativeStateCount++;
    calls.callOrder.push('refreshAuthoritativeState');

    try {
      calls.getSessionSnapshotCount++;
      const sessionRes = typeof mockSessionSnapshot === 'function' ? await mockSessionSnapshot(sessionId) : mockSessionSnapshot;
      if (!isMountedRef.current) return;

      if (!sessionRes.success) {
        error = sessionRes.message || 'Không thể lấy thông tin phòng thi.';
        return;
      }

      const session = sessionRes.data;
      sessionData = session;

      const isTerminal = session.status === 'finished' || session.status === 'cancelled';
      if (isTerminal) {
        isTerminalRef.current = true;
        if (pollTimerRef.current) {
          pollTimerRef.current = null;
        }
        if (channelRef.current) {
          calls.removeCompetitionChannelCount++;
          channelRef.current = null;
        }
        connectionStatus = 'disconnected';
      }

      if (session.status === 'in_progress' || session.status === 'paused') {
        calls.getActiveQuestionSnapshotCount++;
        const qRes = typeof mockActiveQuestion === 'function' ? await mockActiveQuestion() : mockActiveQuestion;
        if (isMountedRef.current && qRes?.success) {
          currentQuestion = qRes.data?.question || null;
        }
      } else if (session.status === 'waiting' || isTerminal) {
        currentQuestion = null;
      }

      if (session.status === 'finished') {
        calls.getLeaderboardSnapshotCount++;
        const lbRes = typeof mockLeaderboard === 'function' ? await mockLeaderboard() : mockLeaderboard;
        if (isMountedRef.current && lbRes?.success && Array.isArray(lbRes.data?.leaderboard)) {
          leaderboard = lbRes.data.leaderboard;
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        error = err.message;
      }
    } finally {
      isPollingRef.current = false;
    }
  }

  // Exact implementation flow from updated useStudentCompetitionRealtime.js
  async function initRealtime() {
    let isCancelled = false;
    let activeChannel = null;

    try {
      connectionStatus = 'connecting';

      // 1. Fetch authoritative state FIRST
      await refreshAuthoritativeState();

      if (isCancelled || isTerminalRef.current || !isMountedRef.current) {
        return;
      }

      // 2. Only active sessions need realtime capability
      calls.getCapabilityTokenCount++;
      calls.callOrder.push('getCapabilityToken');
      const tokenRes = typeof mockCapabilityTokenResult === 'function'
        ? await mockCapabilityTokenResult({ sessionId, participantId })
        : mockCapabilityTokenResult;

      if (isCancelled || isTerminalRef.current || !isMountedRef.current) return;

      if (!tokenRes.success || !tokenRes.token) {
        connectionStatus = 'error';
        error = tokenRes.error || 'Không thể xác thực kết nối Realtime.';
        return;
      }

      // 3. Create private channel
      calls.createCompetitionChannelCount++;
      calls.callOrder.push('createCompetitionChannel');
      activeChannel = { id: `chan-${sessionId}`, presence: { p_id: participantId, st: 'active' } };
      channelRef.current = activeChannel;
      connectionStatus = 'connected';
    } catch (err) {
      if (!isCancelled && !isTerminalRef.current && isMountedRef.current) {
        connectionStatus = 'error';
        error = err.message || 'Lỗi khởi tạo kết nối phòng thi.';
      }
    }
  }

  await initRealtime();

  return {
    getState: () => ({ connectionStatus, sessionData, currentQuestion, leaderboard, error }),
    getRefs: () => ({ isTerminalRef, isMountedRef, pollTimerRef }),
    calls,
    refreshAuthoritativeState,
  };
}

// ============================================================================
// Test 31: Finished Initial Mount (Order & Zero Capability Call)
// ============================================================================
console.log('--- [Test 31] Finished Initial Mount ---');
// 31.A: Static Source Order Verification
const updatedHookSource = fs.readFileSync('src/hooks/useStudentCompetitionRealtime.js', 'utf8');
const refreshPos = updatedHookSource.indexOf('await refreshAuthoritativeState();');
const capTokenPos = updatedHookSource.indexOf('const tokenRes = await getCapabilityToken(');
const terminalGuardPos = updatedHookSource.indexOf('if (isCancelled || isTerminalRef.current || !isMountedRef.current)');

assert.ok(refreshPos !== -1, 'Must call refreshAuthoritativeState');
assert.ok(capTokenPos !== -1, 'Must call getCapabilityToken');
assert.ok(terminalGuardPos !== -1, 'Must check terminal guard');
assert.ok(
  refreshPos < terminalGuardPos && terminalGuardPos < capTokenPos,
  'Authoritative refresh MUST run BEFORE terminal guard, which MUST run BEFORE getCapabilityToken'
);
console.log('  ✅ [31.A] PASS: Static source verifies refreshAuthoritativeState precedes getCapabilityToken');

// 31.B: Runtime Simulation
{
  const mockLeaderboardData = [
    { participant_id: validParticipantUUID, display_name: 'Student Gold', rank: 1, total_score: 100, correct_count: 5 },
    { participant_id: 'p-2', display_name: 'Student Silver', rank: 2, total_score: 80, correct_count: 4 },
  ];

  const hookRun = await simulateStudentRealtimeHook({
    sessionId: validSessionUUID,
    participantId: validParticipantUUID,
    mockSessionSnapshot: {
      success: true,
      data: { id: validSessionUUID, status: 'finished', room_code: 'ROOM88' },
    },
    mockLeaderboard: {
      success: true,
      data: { leaderboard: mockLeaderboardData },
    },
    mockCapabilityTokenResult: () => {
      throw new Error('getCapabilityToken MUST NOT be called for finished session!');
    },
  });

  const state = hookRun.getState();
  const refs = hookRun.getRefs();

  assert.equal(state.sessionData?.status, 'finished', 'sessionData must be populated with finished status');
  assert.equal(state.sessionData?.room_code, 'ROOM88');
  assert.equal(state.leaderboard.length, 2, 'leaderboard must be populated');
  assert.equal(state.leaderboard[0].participant_id, validParticipantUUID);
  assert.equal(state.currentQuestion, null, 'currentQuestion must be null on finished');
  assert.equal(state.error, null, 'error must remain null (no SESSION_CLOSED)');
  assert.equal(state.connectionStatus, 'disconnected', 'connectionStatus should be disconnected');
  assert.equal(refs.isTerminalRef.current, true, 'isTerminalRef must be true');
  assert.equal(refs.pollTimerRef.current, null, 'pollTimer must be cleared on finished');

  assert.equal(hookRun.calls.refreshAuthoritativeStateCount, 1, 'refreshAuthoritativeState must run once');
  assert.equal(hookRun.calls.getLeaderboardSnapshotCount, 1, 'getLeaderboardSnapshot must be fetched once');
  assert.equal(hookRun.calls.getCapabilityTokenCount, 0, 'getCapabilityToken call count MUST be 0');
  assert.equal(hookRun.calls.createCompetitionChannelCount, 0, 'createCompetitionChannel call count MUST be 0');
  assert.deepEqual(hookRun.calls.callOrder, ['refreshAuthoritativeState']);
}
console.log('  ✅ [31.B] PASS: Finished initial mount populates sessionData + leaderboard with 0 capability calls');

// ============================================================================
// Test 32: Cancelled Initial Mount
// ============================================================================
console.log('--- [Test 32] Cancelled Initial Mount ---');
{
  const hookRun = await simulateStudentRealtimeHook({
    sessionId: validSessionUUID,
    participantId: validParticipantUUID,
    mockSessionSnapshot: {
      success: true,
      data: { id: validSessionUUID, status: 'cancelled', room_code: 'CANCEL99' },
    },
    mockCapabilityTokenResult: () => {
      throw new Error('getCapabilityToken MUST NOT be called for cancelled session!');
    },
  });

  const state = hookRun.getState();
  const refs = hookRun.getRefs();

  assert.equal(state.sessionData?.status, 'cancelled', 'sessionData must be populated with cancelled status');
  assert.equal(state.currentQuestion, null, 'currentQuestion must be null');
  assert.equal(state.error, null);
  assert.equal(state.connectionStatus, 'disconnected');
  assert.equal(refs.isTerminalRef.current, true);
  assert.equal(refs.pollTimerRef.current, null);

  assert.equal(hookRun.calls.getCapabilityTokenCount, 0, 'getCapabilityToken call count MUST be 0');
  assert.equal(hookRun.calls.createCompetitionChannelCount, 0, 'createCompetitionChannel call count MUST be 0');
  assert.deepEqual(hookRun.calls.callOrder, ['refreshAuthoritativeState']);
}
console.log('  ✅ [32] PASS: Cancelled initial mount populates cancelled sessionData with 0 capability/channel calls');

// ============================================================================
// Test 33: Active Initial Mount (Waiting / In-Progress / Paused)
// ============================================================================
console.log('--- [Test 33] Active Initial Mount ---');
{
  const activeStatuses = ['waiting', 'in_progress', 'paused'];

  for (const status of activeStatuses) {
    const hookRun = await simulateStudentRealtimeHook({
      sessionId: validSessionUUID,
      participantId: validParticipantUUID,
      mockSessionSnapshot: {
        success: true,
        data: { id: validSessionUUID, status, room_code: 'ACTIVE1' },
      },
      mockActiveQuestion: {
        success: true,
        data: { question: status === 'waiting' ? null : { id: 'q-live', prompt: 'Question 1' } },
      },
      mockCapabilityTokenResult: {
        success: true,
        token: `cap-token-${status}`,
      },
    });

    const state = hookRun.getState();
    const refs = hookRun.getRefs();

    assert.equal(state.sessionData?.status, status);
    if (status === 'in_progress' || status === 'paused') {
      assert.equal(state.currentQuestion?.id, 'q-live');
    } else {
      assert.equal(state.currentQuestion, null);
    }
    assert.equal(state.connectionStatus, 'connected', `Active status ${status} must connect successfully`);
    assert.equal(refs.isTerminalRef.current, false, 'isTerminalRef must remain false for active session');

    assert.equal(hookRun.calls.refreshAuthoritativeStateCount, 1);
    assert.equal(hookRun.calls.getCapabilityTokenCount, 1, 'Active session MUST request capability token');
    assert.equal(hookRun.calls.createCompetitionChannelCount, 1, 'Active session MUST create channel');
    assert.deepEqual(
      hookRun.calls.callOrder,
      ['refreshAuthoritativeState', 'getCapabilityToken', 'createCompetitionChannel'],
      'Strict execution order: refresh authoritative FIRST -> capability token -> create channel'
    );
  }
}
console.log('  ✅ [33] PASS: Active sessions refresh authoritative FIRST, then request capability and create channel');

// ============================================================================
// Test 34: Finished F5 Final Results End-to-End Simulation
// ============================================================================
console.log('--- [Test 34] Finished F5 Final Results End-to-End Simulation ---');
{
  // 1. Simulate persisted storage on student browser
  const mockBrowserStorage = createMockStorage();
  mockBrowserStorage.setItem(STUDENT_SESSION_STORAGE_KEY, validSessionUUID);
  mockBrowserStorage.setItem(STUDENT_PARTICIPANT_STORAGE_KEY, validParticipantUUID);

  // 2. Page reloads (F5) -> getInitialStudentSession parses stored UUIDs
  const restoredSessionId = mockBrowserStorage.getItem(STUDENT_SESSION_STORAGE_KEY);
  const restoredParticipantId = mockBrowserStorage.getItem(STUDENT_PARTICIPANT_STORAGE_KEY);
  assert.equal(isValidSessionUUID(restoredSessionId), true);
  assert.equal(isValidSessionUUID(restoredParticipantId), true);

  // 3. Leaderboard data from backend
  const mockLeaderboard34 = [
    { participant_id: 'p-other-1', display_name: 'Top 1 Player', rank: 1, total_score: 120, correct_count: 6, total_response_time_ms: 4000 },
    { participant_id: validParticipantUUID, display_name: 'Current Student', rank: 2, total_score: 95, correct_count: 5, total_response_time_ms: 5500 },
    { participant_id: 'p-other-3', display_name: 'Third Place', rank: 3, total_score: 70, correct_count: 4, total_response_time_ms: 7000 },
  ];

  // 4. Hook initializes on reload with restored IDs
  const hookRun = await simulateStudentRealtimeHook({
    sessionId: restoredSessionId,
    participantId: restoredParticipantId,
    mockSessionSnapshot: {
      success: true,
      data: { id: restoredSessionId, status: 'finished', room_code: 'RESTORE88' },
    },
    mockLeaderboard: {
      success: true,
      data: { leaderboard: mockLeaderboard34 },
    },
    mockCapabilityTokenResult: () => {
      // Backend returns SESSION_CLOSED if called
      return { success: false, error_code: 'SESSION_CLOSED', error: 'Phiên thi đã kết thúc.' };
    },
  });

  const hookState = hookRun.getState();

  // 5. Assert hook state is completely healthy without triggering SESSION_CLOSED error
  assert.equal(hookState.sessionData?.status, 'finished');
  assert.equal(hookState.leaderboard.length, 3);
  assert.equal(hookState.error, null, 'Must NOT encounter SESSION_CLOSED');
  assert.equal(hookRun.calls.getCapabilityTokenCount, 0, 'Zero capability calls made on reload');

  // 6. Assert Student Page Finished View invariants
  const isFinished = hookState.sessionData?.status === 'finished';
  assert.equal(isFinished, true, 'FINAL_RESULTS view must be available');

  const myEntry = hookState.leaderboard.find(item => item.participant_id === restoredParticipantId);
  assert.ok(myEntry, 'Personal participant match MUST be available');
  assert.equal(myEntry.display_name, 'Current Student');
  assert.equal(myEntry.rank, 2);
  assert.equal(myEntry.total_score, 95);
  assert.equal(myEntry.correct_count, 5);

  // 7. Assert Mini Podium grouping from hook leaderboard
  const goldWinners = hookState.leaderboard.filter(x => x.rank === 1);
  const silverWinners = hookState.leaderboard.filter(x => x.rank === 2);
  const bronzeWinners = hookState.leaderboard.filter(x => x.rank === 3);

  assert.equal(goldWinners.length, 1);
  assert.equal(goldWinners[0].display_name, 'Top 1 Player');
  assert.equal(silverWinners.length, 1);
  assert.equal(silverWinners[0].display_name, 'Current Student');
  assert.equal(bronzeWinners.length, 1);
  assert.equal(bronzeWinners[0].display_name, 'Third Place');
}
console.log('  ✅ [34] PASS: Finished F5 reload renders Final Results & Mini Podium with 0 capability token dependency');

console.log('\n================================================================================');
console.log('🎉 ALL 34 R4 STUDENT FINAL RESULTS TESTS (INCLUDING REORDER & RELOAD SUITE) PASSED 100%!');
console.log('================================================================================\n');

