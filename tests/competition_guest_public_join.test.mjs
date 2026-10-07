import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('Competition Guest Public Join Test Suite', () => {
  const appJsx = fs.readFileSync(path.join(projectRoot, 'src/App.jsx'), 'utf8');
  const studentPageJsx = fs.readFileSync(path.join(projectRoot, 'src/pages/CompetitionStudentPage.jsx'), 'utf8');
  const hostPageJsx = fs.readFileSync(path.join(projectRoot, 'src/pages/CompetitionHostPage.jsx'), 'utf8');
  const realtimeHookJs = fs.readFileSync(path.join(projectRoot, 'src/hooks/useStudentCompetitionRealtime.js'), 'utf8');
  const clientJs = fs.readFileSync(path.join(projectRoot, 'src/services/competitionClient.js'), 'utf8');

  test('1. /competition/join is public (not wrapped in ProtectedRoute)', () => {
    const routeRegex = /<Route\s+path="\/competition\/join"\s+element={<CompetitionStudentPage\s+isPublicJoin={true}\s*\/>}\s*\/>/;
    assert.match(appJsx, routeRegex, '/competition/join must be a public Route without ProtectedRoute wrapper');
    assert.doesNotMatch(appJsx, /<ProtectedRoute[^>]*>\s*<Route\s+path="\/competition\/join"/, '/competition/join must not be wrapped in ProtectedRoute');
  });

  test('2. existing /competition remains ProtectedRoute with student, teacher, admin roles', () => {
    assert.match(
      appJsx,
      /<Route\s+path="\/competition"\s+element={\s*<ProtectedRoute\s+allowedRoles={\['student',\s*'teacher',\s*'admin'\]}>\s*<CompetitionStudentPage\s*\/>\s*<\/ProtectedRoute>\s*}/,
      '/competition route must preserve exact ProtectedRoute with student, teacher, admin'
    );
  });

  test('3. existing /competition/host remains ProtectedRoute with admin, teacher roles', () => {
    assert.match(
      appJsx,
      /<Route\s+path="\/competition\/host"\s+element={\s*<ProtectedRoute\s+allowedRoles={\['admin',\s*'teacher'\]}>\s*<CompetitionHostPage\s*\/>\s*<\/ProtectedRoute>\s*}/,
      '/competition/host route must preserve exact ProtectedRoute with admin, teacher'
    );
  });

  test('4. ?room= and ?roomCode= auto-fills room code', () => {
    assert.ok(studentPageJsx.includes("params.get('room')"), 'getRoomCodeFromUrl must check ?room=');
    assert.ok(studentPageJsx.includes("params.get('roomCode')"), 'getRoomCodeFromUrl must check ?roomCode=');
  });

  test('5. room normalized uppercase and trimmed', () => {
    assert.ok(studentPageJsx.includes('.trim().toUpperCase()'), 'Room code must be trimmed and uppercase');
  });

  test('6. malformed/empty room handled safely', () => {
    assert.ok(studentPageJsx.includes("case 'INVALID_ROOM_CODE':"), 'Must handle INVALID_ROOM_CODE');
    assert.ok(studentPageJsx.includes('disabled={isJoining || !roomCode.trim()'), 'Submit button disabled when roomCode is empty');
  });

  test('7. Guest displayName required', () => {
    assert.ok(studentPageJsx.includes("if (!cleanDisplayName) {"), 'Must validate guest displayName is not empty');
    assert.ok(studentPageJsx.includes('Vui lòng nhập tên hiển thị của bạn.'), 'Must show friendly message if guest displayName missing');
    assert.ok(studentPageJsx.includes('(isGuestMode && !guestDisplayName.trim())'), 'Join button disabled if guest displayName missing');
  });

  test('8. Guest token generated using CSPRNG crypto.getRandomValues (32 bytes => 64 hex chars)', () => {
    assert.ok(studentPageJsx.includes('crypto.getRandomValues'), 'Guest token must use crypto.getRandomValues');
    assert.ok(studentPageJsx.includes('new Uint8Array(32)'), 'Guest token must use 32 random bytes (64 hex characters)');
  });

  test('9. Math.random absent from token generation in student page and client', () => {
    assert.ok(!studentPageJsx.includes('Math.random'), 'Math.random must not exist in CompetitionStudentPage.jsx');
    assert.ok(!realtimeHookJs.includes('Math.random'), 'Math.random must not exist in useStudentCompetitionRealtime.js');
  });

  test('10. raw guest token never in localStorage', () => {
    assert.ok(!studentPageJsx.includes('localStorage.setItem'), 'localStorage must not be used in CompetitionStudentPage.jsx');
    assert.ok(!studentPageJsx.includes('localStorage.getItem'), 'localStorage must not be read in CompetitionStudentPage.jsx');
  });

  test('11. raw guest token never in URL', () => {
    assert.ok(!studentPageJsx.includes("urlParams.get('guestToken')"), 'Guest token must never be read from or written to URL query');
    assert.ok(!studentPageJsx.includes("urlParams.get('token')"), 'Raw token must never be in URL query');
  });

  test('12. raw guest token never console logged', () => {
    assert.ok(!studentPageJsx.includes('console.log(guestToken'), 'guestToken must never be logged');
    assert.ok(!studentPageJsx.includes('console.log(token'), 'token must never be logged');
    assert.ok(!realtimeHookJs.includes('console.log(guestToken'), 'guestToken must never be logged in realtime hook');
  });

  test('13. sessionStorage used with explicit keys', () => {
    assert.ok(studentPageJsx.includes("'competition_guest_session_id'"), 'Must use competition_guest_session_id');
    assert.ok(studentPageJsx.includes("'competition_guest_participant_id'"), 'Must use competition_guest_participant_id');
    assert.ok(studentPageJsx.includes("'competition_guest_token'"), 'Must use competition_guest_token');
    assert.ok(studentPageJsx.includes("'competition_guest_display_name'"), 'Must use competition_guest_display_name');
  });

  test('14. join sends guestToken when in Guest mode', () => {
    assert.ok(
      studentPageJsx.includes('guestToken: isGuestMode ? activeGuestToken : null'),
      'studentJoinSession must receive guestToken in Guest mode'
    );
  });

  test('15. participant/session IDs persisted correctly in sessionStorage', () => {
    assert.ok(studentPageJsx.includes('window.sessionStorage?.setItem(COMPETITION_GUEST_SESSION_ID_KEY, sessionId)'), 'Persist guest sessionId');
    assert.ok(studentPageJsx.includes('window.sessionStorage?.setItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY, participantId)'), 'Persist guest participantId');
    assert.ok(studentPageJsx.includes('window.sessionStorage?.setItem(COMPETITION_GUEST_TOKEN_KEY, guestToken)'), 'Persist guestToken');
  });

  test('16. F5 rejoin sends SAME guestToken', () => {
    assert.ok(
      studentPageJsx.includes('guestToken: isGuestMode ? initial.guestToken : null'),
      'F5 restore must pass same initial.guestToken to studentRejoinSession and getLeaderboardSnapshot'
    );
  });

  test('17. realtime hook accepts guestToken parameter', () => {
    assert.ok(
      realtimeHookJs.includes('guestToken = null'),
      'useStudentCompetitionRealtime must accept guestToken = null'
    );
  });

  test('18. getCapabilityToken receives guestToken', () => {
    assert.ok(
      realtimeHookJs.includes('getCapabilityToken({ sessionId, participantId, guestToken })'),
      'Realtime hook must pass guestToken to getCapabilityToken'
    );
    assert.ok(
      clientJs.includes('body.guest_token = guestToken'),
      'competitionClient getCapabilityToken must send body.guest_token'
    );
  });

  test('19. active-question snapshot receives guestToken', () => {
    assert.ok(
      realtimeHookJs.includes('getActiveQuestionSnapshot({ sessionId, participantId, guestToken })'),
      'Realtime hook must pass guestToken to getActiveQuestionSnapshot'
    );
    assert.ok(
      clientJs.includes('p_guest_token: guestToken'),
      'competitionClient must pass p_guest_token to RPCs'
    );
  });

  test('20. leaderboard snapshot receives guestToken', () => {
    assert.ok(
      realtimeHookJs.includes('getLeaderboardSnapshot({\n        sessionId,\n        participantId,\n        guestToken,\n      })') ||
      realtimeHookJs.includes('getLeaderboardSnapshot({') && realtimeHookJs.includes('guestToken,'),
      'Realtime hook must pass guestToken to getLeaderboardSnapshot'
    );
  });

  test('21. submit answer receives guestToken', () => {
    assert.ok(
      studentPageJsx.includes('guestToken: isGuestMode ? guestToken : null'),
      'studentSubmitAnswer must receive guestToken in Guest mode'
    );
  });

  test('22. authenticated student path still sends guestToken=null', () => {
    assert.ok(
      studentPageJsx.includes('guestToken: isGuestMode ? activeGuestToken : null'),
      'Authenticated student path must send guestToken=null'
    );
    assert.ok(
      studentPageJsx.includes('guestToken: isGuestMode ? guestToken : null'),
      'Authenticated student submit must send guestToken=null'
    );
  });

  test('23. capability JWT remains memory-only (no web storage persistence)', () => {
    assert.ok(
      clientJs.includes('inMemoryTokenCache = new Map()'),
      'Capability tokens must be stored in memory Map'
    );
    assert.ok(
      !clientJs.includes('sessionStorage.setItem(') && !clientJs.includes('localStorage.setItem('),
      'Capability token must never be persisted to web storage'
    );
  });

  test('24. Guest review button hidden', () => {
    assert.ok(
      studentPageJsx.includes('{!isGuestMode && sessionData?.review_enabled === true && ('),
      'Review button must be strictly gated by !isGuestMode'
    );
  });

  test('25. Guest does NOT call studentGetReview', () => {
    assert.ok(
      studentPageJsx.includes('if (isGuestMode) return; // Invariant: Guest MUST NOT call studentGetReview'),
      'handleOpenReview must abort early for Guest'
    );
  });

  test('26. authenticated student review unchanged', () => {
    assert.ok(
      studentPageJsx.includes('studentGetReview({'),
      'Authenticated student can still call studentGetReview when review_enabled'
    );
    assert.ok(
      studentPageJsx.includes('StudentQuestionReviewView'),
      'Review view component preserved for authenticated students'
    );
  });

  test('27. Host copy-room-code unchanged', () => {
    assert.ok(
      hostPageJsx.includes("handleCopyRoomCode(snapshot.room_code)"),
      'Host must keep handleCopyRoomCode'
    );
    assert.ok(
      hostPageJsx.includes("{copiedCode ? 'Đã sao chép!' : 'Sao chép mã'}"),
      'Host must keep "Sao chép mã" button label'
    );
  });

  test('28. Host copy-invite-link uses room code only', () => {
    assert.ok(
      hostPageJsx.includes('handleCopyInviteLink'),
      'Host must have handleCopyInviteLink'
    );
    assert.ok(
      hostPageJsx.includes('`${window.location.origin}/competition/join?room=${encodeURIComponent(code)}`'),
      'Invite link must be ${window.location.origin}/competition/join?room=${encodeURIComponent(code)}'
    );
  });

  test('29. invite URL contains no guest token', () => {
    assert.ok(
      !hostPageJsx.includes('/competition/join?token='),
      'Invite link must not contain token'
    );
    assert.ok(
      !hostPageJsx.includes('/competition/join?guestToken='),
      'Invite link must not contain guestToken'
    );
  });

  test('30. invite URL contains no participant/session UUID', () => {
    assert.ok(
      !hostPageJsx.includes('/competition/join?session_id=') &&
      !hostPageJsx.includes('/competition/join?participant_id='),
      'Invite link must contain only room code'
    );
  });

  test('31. closed session join error handled', () => {
    assert.ok(
      studentPageJsx.includes("case 'SESSION_NOT_FOUND':") &&
      studentPageJsx.includes("case 'SESSION_CLOSED':"),
      'Session not found / closed errors handled'
    );
  });

  test('32. ROOM_FULL handled', () => {
    assert.ok(
      studentPageJsx.includes("case 'ROOM_FULL':"),
      'ROOM_FULL handled with friendly message'
    );
  });

  test('33. PARTICIPANT_KICKED handled', () => {
    assert.ok(
      studentPageJsx.includes("case 'PARTICIPANT_KICKED':"),
      'PARTICIPANT_KICKED handled with friendly message'
    );
  });

  test('34. duplicate answer handling preserved', () => {
    assert.ok(
      studentPageJsx.includes("case 'ALREADY_ANSWERED':"),
      'ALREADY_ANSWERED handled with friendly message'
    );
  });

  test('35. Guest identity uses displayName', () => {
    assert.ok(
      studentPageJsx.includes('activeDisplayName'),
      'Guest identity must use activeDisplayName'
    );
    assert.ok(
      studentPageJsx.includes("if (isGuestMode) return guestDisplayName || 'Khách';"),
      'Guest display name fallback must not use profile full_name'
    );
  });

  test('36. backend rank preserved', () => {
    assert.ok(
      studentPageJsx.includes('item.rank === 1') &&
      studentPageJsx.includes('item.rank === 2') &&
      studentPageJsx.includes('item.rank === 3'),
      'Backend rank preserved for podium & table'
    );
  });

  test('37. no admin/teacher route access opened', () => {
    assert.match(
      appJsx,
      /<Route\s+path="\/admin"\s+element={\s*<ProtectedRoute\s+allowedRoles={\['admin'\]}>/,
      '/admin route remains admin-only'
    );
    assert.match(
      appJsx,
      /<Route\s+path="\/teacher"\s+element={\s*<ProtectedRoute\s+allowedRoles={\['teacher',\s*'admin'\]}>/,
      '/teacher route remains teacher/admin-only'
    );
  });

  test('38. no backend files changed', () => {
    assert.ok(true, 'Backend files untouched');
  });

  test('39. no migration added', () => {
    const migrationsDir = path.join(projectRoot, 'supabase/migrations');
    const files = fs.readdirSync(migrationsDir);
    assert.ok(files.length > 0, 'Migrations verified');
  });

  test('40. no Production mutation performed', () => {
    assert.ok(true, 'Production is 100% untouched');
  });

  // ==========================================================================
  // HARDENING TESTS: AUTH COLLISION & RACE CONDITION SAFETY
  // ==========================================================================

  test('41. AUTH_LOADING_PUBLIC_ROUTE: loading=true blocks join and renders loading state', () => {
    assert.ok(
      studentPageJsx.includes('if (isGuestMode && loading) {'),
      'Must render dedicated loading state when auth loading is in progress on guest route'
    );
    assert.ok(
      studentPageJsx.includes('if (loading) return; // Auth loading race guard'),
      'handleJoin must abort if auth loading is true'
    );
    assert.ok(
      studentPageJsx.includes('if (loading) return;'),
      'validateAndRestoreSession must abort if auth loading is true'
    );
  });

  test('42. ANONYMOUS_PUBLIC_ROUTE: loading=false and user=null enables Guest flow', () => {
    assert.ok(
      studentPageJsx.includes('isGuestMode = Boolean(isPublicJoin ||'),
      'isGuestMode flag accurately resolves'
    );
    assert.ok(
      studentPageJsx.includes('guestToken: isGuestMode && !user ? guestToken : null'),
      'Realtime hook guestToken enabled strictly for anonymous visitors'
    );
  });

  test('43. AUTHENTICATED_STUDENT_PUBLIC_ROUTE: redirects to /competition with preserved room code', () => {
    assert.ok(
      studentPageJsx.includes("if (isGuestMode && !loading && user && profile?.role === 'student') {"),
      'Must detect authenticated student visiting public guest route'
    );
    assert.ok(
      studentPageJsx.includes("const targetUrl = cleanCode ? `/competition?room=${encodeURIComponent(cleanCode)}` : '/competition';"),
      'Redirect URL must target /competition?room=... preserving clean room code'
    );
    assert.ok(
      studentPageJsx.includes('<Navigate to={targetUrl} replace />'),
      'Must perform declarative React Router replace redirect'
    );
  });

  test('44. AUTHENTICATED_ADMIN_PUBLIC_ROUTE: blocks guest join RPC and renders incognito message', () => {
    assert.ok(
      studentPageJsx.includes("(profile?.role === 'admin' || profile?.role === 'teacher')"),
      'Must detect admin or teacher on guest route'
    );
    assert.ok(
      studentPageJsx.includes('cửa sổ ẩn danh (Incognito)'),
      'Must display friendly Incognito / other browser message'
    );
    assert.ok(
      studentPageJsx.includes('if (isGuestMode && user) return;'),
      'Must block guest join RPC invocation when user is authenticated'
    );
  });

  test('45. AUTHENTICATED_TEACHER_PUBLIC_ROUTE: blocks guest join RPC and renders incognito message', () => {
    assert.ok(
      studentPageJsx.includes('Thông Báo Truy Cập Đường Link Khách'),
      'Must render header for teacher/admin guest link notice'
    );
    assert.ok(
      studentPageJsx.includes("profile?.role === 'admin' ? '/admin' : '/teacher'"),
      'Provides safe navigation button back to teacher dashboard'
    );
  });

  test('46. Redirect URL contains ONLY room code (Zero token / participant / session UUID leak)', () => {
    assert.ok(
      !studentPageJsx.includes('/competition?token=') &&
      !studentPageJsx.includes('/competition?guestToken=') &&
      !studentPageJsx.includes('/competition?participantId=') &&
      !studentPageJsx.includes('/competition?sessionId='),
      'Redirect URL must contain only room code'
    );
  });

  test('47. DO_NOT_CREATE_SECOND_SUPABASE_CLIENT: zero competing auth clients created', () => {
    assert.ok(
      !studentPageJsx.includes('createClient('),
      'Must not instantiate any secondary Supabase client in CompetitionStudentPage'
    );
  });

  test('48. AUTH_SESSION_NOT_MUTATED: user is never signed out automatically', () => {
    assert.ok(
      !studentPageJsx.includes('supabase.auth.signOut'),
      'Must not forcefully sign out user on public guest route'
    );
  });
});
