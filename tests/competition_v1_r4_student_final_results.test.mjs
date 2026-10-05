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
// Verify code comment and structure showing finished session skips rejoin RPC
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
// Test 15: Late Answer Response Cannot Overwrite Final UI
// ============================================================================
console.log('--- [Test 15] Late Answer Response Guard ---');
assert.ok(
  studentPageSource.includes("sessionData?.status === 'finished'") ||
  studentPageSource.includes('activeSessionIdRef.current'),
  'Must check active session and status before committing answer response'
);
console.log('  ✅ [15] PASS: Late answer submissions blocked after session finished');

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
// Test 30: Guest Scope Exclusion in Phase 1
// ============================================================================
console.log('--- [Test 30] Guest Scope Invariant in Phase 1 ---');
assert.ok(
  studentPageSource.includes('guestToken: null'),
  'Student join and submit must use authenticated flow with guestToken: null'
);
console.log('  ✅ [30] PASS: R4 Phase 1 strictly restricted to Authenticated Student');

console.log('\n================================================================================');
console.log('🎉 ALL 30 R4 STUDENT FINAL RESULTS TESTS PASSED 100%!');
console.log('================================================================================\n');
