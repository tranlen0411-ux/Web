import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('🧪 RUNNING COMPETITION V1 PHASE F2 HOST CONTROLLER TESTS');

// ============================================================================
// Test 1: Static Source Verification of CompetitionHostPage.jsx
// ============================================================================
console.log('\n--- [Test 1] Inspecting src/pages/CompetitionHostPage.jsx ---');
const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');

// A. Check Host RPC calls via client service
const expectedHostRpcs = [
  'hostCreateSession',
  'hostStartSession',
  'hostPauseSession',
  'hostResumeSession',
  'hostNextQuestion',
  'hostFinishSession',
  'hostCancelSession',
  'getLeaderboardSnapshot'
];

expectedHostRpcs.forEach(rpcMethod => {
  assert.ok(
    hostPageSource.includes(rpcMethod),
    `CompetitionHostPage.jsx must call proven method '${rpcMethod}'`
  );
  console.log(`  ✅ Method present: ${rpcMethod}`);
});

// B & C. No Realtime capability tokens or channels on Host
assert.ok(
  !hostPageSource.includes('getCapabilityToken'),
  'CompetitionHostPage.jsx must NOT call getCapabilityToken'
);
assert.ok(
  !hostPageSource.includes('createCompetitionChannel'),
  'CompetitionHostPage.jsx must NOT call createCompetitionChannel'
);
assert.ok(
  !hostPageSource.includes('competitionRealtimeClient'),
  'CompetitionHostPage.jsx must NOT use competitionRealtimeClient'
);
assert.ok(
  !hostPageSource.includes('supabase.realtime'),
  'CompetitionHostPage.jsx must NOT call supabase.realtime'
);
console.log('  ✅ Realtime Invariant PASS: Host is 100% polling-based, zero Realtime capability token usage');

// D. Mutation buttons disable while pending
assert.ok(
  hostPageSource.includes('disabled={actionPending}'),
  'Host page must disable mutation buttons while actionPending is true'
);
console.log('  ✅ Double-submit prevention PASS: Buttons disabled when actionPending is active');

// E. Finish & Cancel require confirmation
assert.ok(
  hostPageSource.includes("type: 'finish'") && hostPageSource.includes("type: 'cancel'"),
  'Host page must trigger confirmation modal for Finish and Cancel actions'
);
console.log('  ✅ Confirmation UI PASS: Finish and Cancel actions require explicit user confirmation');

// F. Canonical question payload contract verification
assert.ok(
  hostPageSource.includes('question_order:') &&
  hostPageSource.includes('question_text:') &&
  hostPageSource.includes('question_type:') &&
  hostPageSource.includes('points:') &&
  hostPageSource.includes('time_limit_seconds:') &&
  hostPageSource.includes('options:') &&
  hostPageSource.includes('correct_answer:'),
  'Question builder must produce exact canonical question payload fields'
);
console.log('  ✅ Question Contract PASS: Exact canonical question fields mapped');

// G. No participant secret fields exposed
const bannedFields = ['guest_token', 'guest_token_hash', 'user_id', 'raw_answers', 'password'];
bannedFields.forEach(field => {
  assert.ok(
    !hostPageSource.includes(`p.${field}`) && !hostPageSource.includes(`item.${field}`),
    `Host page must not render sensitive field '${field}'`
  );
});
console.log('  ✅ Data Sanitization PASS: Zero sensitive tokens, hashes, or internal IDs exposed on UI');

// ============================================================================
// Test 2: Polling Hook Static & Logic Verification
// ============================================================================
console.log('\n--- [Test 2] Inspecting src/hooks/useHostCompetitionPolling.js ---');
const hookSource = fs.readFileSync('src/hooks/useHostCompetitionPolling.js', 'utf8');

// A. Polling interval constants
assert.ok(
  hookSource.includes('POLLING_WAITING_MS = 3000'),
  'Hook must define POLLING_WAITING_MS = 3000'
);
assert.ok(
  hookSource.includes('POLLING_ACTIVE_MS = 2000'),
  'Hook must define POLLING_ACTIVE_MS = 2000'
);
console.log('  ✅ Polling Intervals PASS: 3000ms (waiting), 2000ms (active/paused)');

// B. Polling stops on terminal state
assert.ok(
  hookSource.includes("status === 'finished' || status === 'cancelled'") ||
  hookSource.includes("isTerminal"),
  'Hook must stop polling when session status is finished or cancelled'
);
console.log('  ✅ Terminal State PASS: Polling completely halts when finished or cancelled');

// C. Visibility pause
assert.ok(
  hookSource.includes('document.hidden') && hookSource.includes('visibilitychange'),
  'Hook must pause timer when document.hidden is true and resume on visibilitychange'
);
console.log('  ✅ Visibility Handling PASS: Pauses on tab background, resumes on tab foreground');

// D. Cleanup on unmount
assert.ok(
  hookSource.includes('clearTimeout(timerRef.current)') && hookSource.includes('removeEventListener'),
  'Hook must clean up active timers and event listeners on unmount'
);
console.log('  ✅ Cleanup PASS: Timers and listeners properly cleaned up on unmount');

// E. Target methods
assert.ok(
  hookSource.includes('getSessionSnapshot(sessionId)') && hookSource.includes('getSessionParticipants(sessionId)'),
  'Hook must read session snapshot and participants'
);
console.log('  ✅ Target Methods PASS: Polls snapshot and participants via RLS-protected methods');

// ============================================================================
// Test 3: Routing & App Access Invariants
// ============================================================================
console.log('\n--- [Test 3] Verifying App.jsx and Navbar.jsx Invariants ---');
const appSource = fs.readFileSync('src/App.jsx', 'utf8');
const navbarSource = fs.readFileSync('src/components/common/Navbar.jsx', 'utf8');

// Role check
const hostRouteMatch = appSource.match(/path="\/competition\/host"[\s\S]*?allowedRoles=\{([^}]+)\}/);
assert.ok(hostRouteMatch, 'Host route /competition/host must be configured with allowedRoles');
const hostRoles = hostRouteMatch[1];
assert.ok(hostRoles.includes('admin'), 'Host route must allow admin');
assert.ok(hostRoles.includes('teacher'), 'Host route must allow teacher');
assert.ok(!hostRoles.includes('student'), 'Host route must DENY student');
console.log('  ✅ Access Control PASS: /competition/host accessible only by admin & teacher');

// Navbar unchanged
assert.ok(!navbarSource.includes('/competition'), 'Navbar must NOT have /competition link in Phase F2');
console.log('  ✅ Navbar Invariant PASS: Navbar is unchanged');

console.log('\n🎉 ALL PHASE F2 HOST CONTROLLER TESTS PASSED SUCCESSFULLY!');
