import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 RUNNING COMPETITION F3 STUDENT ARENA TESTS');

// ============================================================================
// 1. Static Contract & Source Inspection: src/services/competitionClient.js
// ============================================================================
console.log('\n--- [Test 1] Inspecting src/services/competitionClient.js ---');
const clientSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');

// A. studentJoinSession exact parameter mapping
assert.ok(
  clientSource.includes('competition_join_session'),
  'competitionClient.js must call competition_join_session'
);
['p_room_code', 'p_display_name', 'p_avatar_url', 'p_team_id', 'p_guest_token'].forEach(param => {
  assert.ok(
    clientSource.includes(param),
    `competitionClient.js must map exact join param '${param}'`
  );
});
console.log('  ✅ [A] studentJoinSession exact parameter mapping verified');

// B. Authenticated join contract (no guest token required)
assert.ok(
  clientSource.includes('guestToken = null'),
  'competitionClient.js studentJoinSession must support guestToken = null for authenticated flow'
);
console.log('  ✅ [B] Authenticated join without guest token verified');

// C. Capability token requested only after participant ID exists
assert.ok(
  clientSource.includes('if (!sessionId || !participantId)'),
  'getCapabilityToken must reject calls without valid sessionId and participantId'
);
console.log('  ✅ [C] Capability token requires verified participant ID');

// D. Private channel topic exact
assert.ok(
  clientSource.includes('`competition:session:${sessionId}`'),
  'Private channel topic must be exactly competition:session:<session_id>'
);
assert.ok(
  clientSource.includes('private: true'),
  'Channel configuration must enforce private: true'
);
console.log('  ✅ [D] Private channel topic & private:true verified');

// E. Presence payload { p_id, st }
assert.ok(
  clientSource.includes("{ p_id: participantId, st: 'active' }"),
  "Presence payload must strictly match { p_id: participantId, st: 'active' }"
);
console.log('  ✅ [E] Presence payload structure verified');

// F. Storage invariants: No localStorage/sessionStorage capability tokens
assert.ok(
  !clientSource.includes('localStorage'),
  'competitionClient.js must NOT use localStorage'
);
assert.ok(
  !clientSource.includes('sessionStorage'),
  'competitionClient.js must NOT use sessionStorage'
);
assert.ok(
  clientSource.includes('inMemoryTokenCache'),
  'Tokens must be held in inMemoryTokenCache'
);
console.log('  ✅ [F] In-memory capability token storage verified');

// G. No postgres_changes
assert.ok(
  !clientSource.includes('postgres_changes'),
  'competitionClient.js must NOT subscribe to postgres_changes'
);
console.log('  ✅ [G] No postgres_changes in client service');

// H. No client Broadcast send
assert.ok(
  !clientSource.includes("channel.send({ type: 'broadcast'"),
  'Client must NOT perform broadcast send'
);
console.log('  ✅ [H] No client Broadcast send verified');

// Q. Question source is proven student-safe
assert.ok(
  clientSource.includes('export async function getQuestionSnapshot'),
  'competitionClient.js must export getQuestionSnapshot'
);
const getQFuncMatch = clientSource.match(/export async function getQuestionSnapshot[\s\S]*?^}/m);
assert.ok(getQFuncMatch, 'getQuestionSnapshot function body found');
assert.ok(
  !getQFuncMatch[0].includes("select('*')") && !getQFuncMatch[0].includes("'id, session_id, question_order, question_text, question_type, options, points, time_limit_seconds, correct_answer'"),
  'getQuestionSnapshot must never query or expose correct_answer'
);
assert.ok(
  getQFuncMatch[0].includes('.select(') && !getQFuncMatch[0].includes('correct_answer'),
  'getQuestionSnapshot select query must not include correct_answer'
);
console.log('  ✅ [Q] Student-safe question snapshot reader verified');


// R. Leaderboard uses sanitized RPC only
assert.ok(
  clientSource.includes('competition_get_leaderboard_snapshot'),
  'Leaderboard must strictly use competition_get_leaderboard_snapshot RPC'
);
console.log('  ✅ [R] Leaderboard uses sanitized RPC only');


// ============================================================================
// 2. Inspection: src/hooks/useStudentCompetitionRealtime.js
// ============================================================================
console.log('\n--- [Test 2] Inspecting src/hooks/useStudentCompetitionRealtime.js ---');
const hookSource = fs.readFileSync('src/hooks/useStudentCompetitionRealtime.js', 'utf8');

// Storage and Realtime invariants in hook
assert.ok(
  !hookSource.includes('localStorage') && !hookSource.includes('sessionStorage'),
  'useStudentCompetitionRealtime must NOT touch browser web storage'
);
assert.ok(
  !hookSource.includes('postgres_changes'),
  'useStudentCompetitionRealtime must NOT use postgres_changes'
);
assert.ok(
  !hookSource.includes('.send('),
  'useStudentCompetitionRealtime must NOT emit broadcast sends'
);
console.log('  ✅ Hook storage and realtime isolation verified');

// Hook presence and cleanup
assert.ok(
  hookSource.includes('presence: { p_id: participantId, st: \'active\' }'),
  'Hook must pass exact presence payload'
);
assert.ok(
  hookSource.includes('removeCompetitionChannel'),
  'Hook must cleanup channel on unmount via removeCompetitionChannel'
);
assert.ok(
  hookSource.includes('document.hidden'),
  'Hook must check document.hidden to pause polling in background'
);
assert.ok(
  hookSource.includes('visibilitychange'),
  'Hook must listen to visibilitychange for instant resume'
);
assert.ok(
  hookSource.includes("sessionData?.status === 'finished'") || hookSource.includes("['finished', 'cancelled'].includes"),
  'Hook must halt polling on terminal states'
);
console.log('  ✅ [L, M] Hook channel cleanup, visibility pause/resume, and terminal lifecycle verified');


// ============================================================================
// 3. Inspection: src/pages/CompetitionStudentPage.jsx
// ============================================================================
console.log('\n--- [Test 3] Inspecting src/pages/CompetitionStudentPage.jsx ---');
const studentPageSource = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');

// I. correct_answer never rendered in Student page
assert.ok(
  !studentPageSource.includes('correct_answer'),
  'CompetitionStudentPage must NEVER reference or render correct_answer'
);
assert.ok(
  !studentPageSource.includes('explanation'),
  'CompetitionStudentPage must NOT expose explanation'
);
console.log('  ✅ [I] Zero correct_answer or explanation exposure verified');

// J. Submit uses selected option ID only
assert.ok(
  studentPageSource.includes('selectedOptionIds: [selectedOptionId]'),
  'Submit answer must pass selectedOptionId as array element'
);
console.log('  ✅ [J] Single choice submit uses selected option ID only');

// K. Double-submit UI guard exists
assert.ok(
  studentPageSource.includes('isSubmitting') && studentPageSource.includes('hasSubmittedCurrentQuestion'),
  'CompetitionStudentPage must use isSubmitting and hasSubmittedCurrentQuestion flags'
);
assert.ok(
  studentPageSource.includes('disabled={!selectedOptionId || isSubmitting') || studentPageSource.includes('disabled={disabled}'),
  'Submit button and options must be locked during submission'
);
console.log('  ✅ [K] Double-submit UI guard verified');

// P. Teacher/Admin accidental student join guard
assert.ok(
  studentPageSource.includes("profile?.role === 'student'") || studentPageSource.includes("isStudentRole"),
  'CompetitionStudentPage must verify student role'
);
assert.ok(
  studentPageSource.includes('Khu Vực Dành Riêng Cho Học Sinh'),
  'CompetitionStudentPage must show friendly role notice for non-students'
);
console.log('  ✅ [P] Non-student role guard verified');


// ============================================================================
// 4. Boundary & App Invariants
// ============================================================================
console.log('\n--- [Test 4] Verifying App Route & Navbar Invariants ---');
const appSource = fs.readFileSync('src/App.jsx', 'utf8');
assert.ok(
  appSource.includes('path="/competition"'),
  'App.jsx must retain /competition route'
);
assert.ok(
  appSource.includes('CompetitionStudentPage'),
  'App.jsx must render CompetitionStudentPage for student'
);
console.log('  ✅ [N] Student route protected and configured');

const navbarSource = fs.readFileSync('src/components/common/Navbar.jsx', 'utf8');
assert.ok(
  !navbarSource.includes('to="/competition"') && !navbarSource.includes("to='/competition'"),
  'Navbar must NOT include /competition link in F3'
);
console.log('  ✅ [O] Navbar unchanged (Zero /competition links added)');

console.log('\n🎉 ALL COMPETITION F3 STUDENT ARENA TESTS PASSED PERFECTLY!\n');
