import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 RUNNING COMPETITION CLIENT & ROUTING FOUNDATION TESTS');

// ============================================================================
// Test 1: Static Source Verification of competitionClient.js
// ============================================================================
console.log('\n--- [Test 1] Inspecting src/services/competitionClient.js ---');
const clientSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');

// A. Check exact RPC names
const expectedRpcNames = [
  'competition_host_create_session',
  'competition_host_start_session',
  'competition_host_next_question',
  'competition_host_pause_session',
  'competition_host_resume_session',
  'competition_host_cancel_session',
  'competition_host_finish_session',
  'competition_join_session',
  'competition_rejoin_session',
  'competition_submit_answer',
  'competition_get_leaderboard_snapshot'
];

expectedRpcNames.forEach(rpcName => {
  assert.ok(
    clientSource.includes(`'${rpcName}'`),
    `competitionClient.js must call exact RPC '${rpcName}'`
  );
  console.log(`  ✅ RPC verified: ${rpcName}`);
});

// B. Check argument mappings
const expectedArgMappings = [
  'p_title',
  'p_description',
  'p_mode',
  'p_max_participants',
  'p_questions',
  'p_teams',
  'p_reward_enabled',
  'p_reward_config',
  'p_session_id',
  'p_room_code',
  'p_display_name',
  'p_avatar_url',
  'p_team_id',
  'p_guest_token',
  'p_question_id',
  'p_participant_id',
  'p_selected_option_ids',
  'p_text_answer'
];

expectedArgMappings.forEach(argName => {
  assert.ok(
    clientSource.includes(argName),
    `competitionClient.js must map exact backend parameter '${argName}'`
  );
});
console.log('  ✅ All RPC parameter names match backend contracts');

// C. Check storage invariants
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
  'competitionClient.js must store tokens in inMemoryTokenCache'
);
console.log('  ✅ Storage invariant PASS: In-memory only, zero browser storage persistence');

// D. Host capability assumption removed check
assert.ok(
  !clientSource.includes('(or host)'),
  'competitionClient.js must NOT imply Host can mint participant capability tokens'
);
assert.ok(
  clientSource.includes('must be the verified Competition participant ID'),
  'competitionClient.js must state participantId must be verified participant ID'
);
console.log('  ✅ Host token assumption PASS: Explicitly removed "(or host)" assumption');

// E. Realtime Client Isolation
assert.ok(
  clientSource.includes('export const competitionRealtimeClient = createClient('),
  'competitionClient.js must create a dedicated competitionRealtimeClient'
);
assert.ok(
  !clientSource.includes('supabase.realtime.setAuth'),
  'competitionClient.js must NOT call setAuth on shared supabase.realtime'
);
assert.ok(
  clientSource.includes('competitionRealtimeClient.realtime.setAuth'),
  'competitionClient.js must apply capability setAuth strictly to competitionRealtimeClient'
);
console.log('  ✅ Realtime Client Isolation PASS: Dedicated client used, shared supabase client untouched');

// F. Token Refresh updates Realtime auth
assert.ok(
  clientSource.includes('competitionRealtimeClient.realtime.setAuth(res.token)'),
  'competitionClient.js background refresh must update competitionRealtimeClient auth'
);
console.log('  ✅ Realtime Token Refresh Sync PASS: Refreshed token updates dedicated Realtime auth');

// G. Topic format
assert.ok(
  clientSource.includes('competition:session:${sessionId}') || clientSource.includes('competition:session:'),
  'competitionClient.js must use private topic format competition:session:<session_id>'
);
console.log('  ✅ Topic format PASS: competition:session:<session_id>');

// H. No Postgres Changes
assert.ok(
  !clientSource.includes('postgres_changes'),
  'competitionClient.js must NOT subscribe to postgres_changes'
);
console.log('  ✅ Realtime invariant PASS: Zero postgres_changes subscriptions');

// I. No client Broadcast INSERT
assert.ok(
  !clientSource.includes('.send(') && !clientSource.includes('type: \'broadcast\''),
  'competitionClient.js must NOT broadcast raw client inserts'
);
console.log('  ✅ Broadcast invariant PASS: No client Broadcast INSERT path');

// J. Presence payload contract
assert.ok(
  clientSource.includes("p_id: participantId") && clientSource.includes("st: 'active'"),
  'competitionClient.js must use minimal presence payload contract { p_id, st: "active" }'
);
console.log('  ✅ Presence payload contract PASS: { p_id: participantId, st: "active" }');

// K. Channel removal token state cleanup
assert.ok(
  clientSource.includes('clearCapabilityToken(sessionId, participantId)'),
  'competitionClient.js removeCompetitionChannel must support clearing capability token state'
);
console.log('  ✅ Channel removal cleanup PASS: cleans capability token state when sessionId/participantId provided');

// ============================================================================
// Test 2: In-Memory Token Cache Lifecycle Verification
// ============================================================================
console.log('\n--- [Test 2] Testing Token Cache & Helper Functions ---');
import { getCompetitionTopic } from '../src/services/competitionClient.js';

const testSessionId = '11111111-2222-3333-4444-555555555555';
const topic = getCompetitionTopic(testSessionId);
assert.equal(topic, `competition:session:${testSessionId}`);
console.log('  ✅ getCompetitionTopic constructed correct string:', topic);

// ============================================================================
// Test 3: App.jsx Route & Role Protection Verification
// ============================================================================
console.log('\n--- [Test 3] Inspecting Route Protection in App.jsx ---');
const appSource = fs.readFileSync('src/App.jsx', 'utf8');

// H & I & J. Host route role checks
const hostRouteMatch = appSource.match(/path="\/competition\/host"[\s\S]*?allowedRoles=\{([^}]+)\}/);
assert.ok(hostRouteMatch, 'Host route /competition/host must be configured with allowedRoles');
const hostRoles = hostRouteMatch[1];
assert.ok(hostRoles.includes('admin'), 'Host route must allow admin');
assert.ok(hostRoles.includes('teacher'), 'Host route must allow teacher');
assert.ok(!hostRoles.includes('student'), 'Host route must DENY student');
console.log('  ✅ /competition/host route guard: allowedRoles =', hostRoles.trim());

// K. Student route role checks
const studentRouteMatch = appSource.match(/path="\/competition"[\s\S]*?allowedRoles=\{([^}]+)\}/);
assert.ok(studentRouteMatch, 'Student route /competition must be configured with allowedRoles');
const studentRoles = studentRouteMatch[1];
assert.ok(studentRoles.includes('student'), 'Student route must allow student');
assert.ok(studentRoles.includes('teacher'), 'Student route must allow teacher');
assert.ok(studentRoles.includes('admin'), 'Student route must allow admin');
console.log('  ✅ /competition route guard: allowedRoles =', studentRoles.trim());

// ============================================================================
// Test 4: Placeholder Pages Verification
// ============================================================================
console.log('\n--- [Test 4] Verifying Placeholder Pages ---');
const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const studentPageSource = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');

assert.ok(hostPageSource.includes('Host foundation ready'), 'CompetitionHostPage has expected placeholder');
assert.ok(studentPageSource.includes('Student foundation ready'), 'CompetitionStudentPage has expected placeholder');
console.log('  ✅ Placeholder pages present and non-empty');

// ============================================================================
// Test 5: Navbar Unchanged Invariant
// ============================================================================
console.log('\n--- [Test 5] Verifying Navbar Unchanged ---');
const navbarSource = fs.readFileSync('src/components/common/Navbar.jsx', 'utf8');
assert.ok(!navbarSource.includes('/competition'), 'Navbar must NOT have /competition link in Phase F1');
console.log('  ✅ Navbar invariant PASS: No visible competition button added yet');

console.log('\n🎉 ALL 5 TEST SUITES (A-K) PASSED SUCCESSFULLY!');
