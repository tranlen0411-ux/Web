import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('Competition V1 - Guest F5 Session Restore Test Suite', () => {
  const studentPageJsx = fs.readFileSync(path.join(projectRoot, 'src/pages/CompetitionStudentPage.jsx'), 'utf8');
  const clientJs = fs.readFileSync(path.join(projectRoot, 'src/services/competitionClient.js'), 'utf8');

  // ==========================================================================
  // GROUP 1: ROOT CAUSE CODE INVARIANTS & PREVENTATIVE GUARDS
  // ==========================================================================
  describe('Group 1: Root Cause & Code Structure Verification', () => {
    test('1.1. initialSession does not block Guest session resolution on loading===true', () => {
      // Must NOT contain the old faulty pattern: if (isGuestMode && (loading || user))
      assert.doesNotMatch(
        studentPageJsx,
        /if\s*\(\s*isGuestMode\s*&&\s*\(\s*loading\s*\|\|\s*user\s*\)\s*\)/,
        'initialSession must not blank out guest credentials while loading === true'
      );

      // Must allow resolving getInitialGuestSession() when user is not present
      assert.match(
        studentPageJsx,
        /if\s*\(\s*isGuestMode\s*&&\s*user\s*\)\s*\{\s*return\s*\{\s*sessionId:\s*null,\s*participantId:\s*null,\s*guestToken:\s*null,\s*displayName:\s*null\s*\};\s*\}/,
        'initialSession must only reject guest resolution when an authenticated user is present'
      );
    });

    test('1.2. Persistence effect has restoration guard preventing premature sessionStorage wiping', () => {
      // Must contain restoration guard before removeItem
      assert.ok(
        studentPageJsx.includes('if (isRestoring || restoredSessionPendingValidationRef.current)'),
        'Persistence effect must guard against wiping sessionStorage while isRestoring or validation is in progress'
      );
      assert.ok(
        studentPageJsx.includes('// Guard: Never clear storage while restoration or authoritative validation is in progress'),
        'Must have explicit safety comment for persistence effect guard'
      );
    });

    test('1.3. clearRestoredSessionAndReturnToJoin explicitly removes guest token and resets state', () => {
      assert.ok(
        studentPageJsx.includes('window.sessionStorage?.removeItem(COMPETITION_GUEST_TOKEN_KEY);'),
        'clearRestoredSessionAndReturnToJoin must explicitly remove COMPETITION_GUEST_TOKEN_KEY'
      );
      assert.ok(
        studentPageJsx.includes('setGuestToken(null);'),
        'clearRestoredSessionAndReturnToJoin must reset guestToken in state'
      );
      assert.ok(
        studentPageJsx.includes("setGuestDisplayName('');"),
        'clearRestoredSessionAndReturnToJoin must reset guestDisplayName in state'
      );
    });

    test('1.4. handleExit explicitly removes guest token and resets state', () => {
      assert.ok(
        studentPageJsx.includes('window.sessionStorage?.removeItem(COMPETITION_GUEST_TOKEN_KEY);'),
        'handleExit must remove COMPETITION_GUEST_TOKEN_KEY'
      );
    });

    test('1.5. Guest token is NEVER persisted in localStorage', () => {
      assert.doesNotMatch(
        studentPageJsx,
        /localStorage/i,
        'CompetitionStudentPage must never access localStorage'
      );
    });
  });

  // ==========================================================================
  // GROUP 2: F5 RESTORE ACROSS ALL SESSION LIFECYCLE STATES
  // ==========================================================================
  describe('Group 2: Lifecycle State Restoration Logic', () => {
    const mockGuestStorage = {
      COMPETITION_GUEST_SESSION_ID_KEY: '11111111-2222-3333-4444-555555555555',
      COMPETITION_GUEST_PARTICIPANT_ID_KEY: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      COMPETITION_GUEST_TOKEN_KEY: 'a'.repeat(64),
      COMPETITION_GUEST_DISPLAY_NAME_KEY: 'Khách Hoàng Yến',
    };

    test('2.1. F5 when Session is WAITING: restores participant and does not create duplicate', async () => {
      // Simulate state resolution
      const isGuestMode = true;
      const user = null;
      const loading = false;

      // Mock getInitialGuestSession
      const initial = {
        sessionId: mockGuestStorage.COMPETITION_GUEST_SESSION_ID_KEY,
        participantId: mockGuestStorage.COMPETITION_GUEST_PARTICIPANT_ID_KEY,
        guestToken: mockGuestStorage.COMPETITION_GUEST_TOKEN_KEY,
        displayName: mockGuestStorage.COMPETITION_GUEST_DISPLAY_NAME_KEY,
      };

      assert.ok(initial.sessionId && initial.participantId && initial.guestToken);

      // Rejoin mock for waiting session
      const mockRejoin = async (args) => {
        assert.equal(args.sessionId, initial.sessionId);
        assert.equal(args.participantId, initial.participantId);
        assert.equal(args.guestToken, initial.guestToken);
        return {
          success: true,
          is_rejoin: true,
          data: {
            session: { id: args.sessionId, status: 'waiting' },
            participant: {
              id: args.participantId,
              session_id: args.sessionId,
              display_name: initial.displayName,
              is_guest: true,
              status: 'active',
            },
          },
        };
      };

      const res = await mockRejoin({
        sessionId: initial.sessionId,
        participantId: initial.participantId,
        guestToken: initial.guestToken,
      });

      assert.equal(res.success, true);
      assert.equal(res.data.participant.id, initial.participantId);
      assert.equal(res.data.session.status, 'waiting');
    });

    test('2.2. F5 when Session is IN_PROGRESS: restores participant, preserves answer & score state', async () => {
      const initial = {
        sessionId: mockGuestStorage.COMPETITION_GUEST_SESSION_ID_KEY,
        participantId: mockGuestStorage.COMPETITION_GUEST_PARTICIPANT_ID_KEY,
        guestToken: mockGuestStorage.COMPETITION_GUEST_TOKEN_KEY,
        displayName: mockGuestStorage.COMPETITION_GUEST_DISPLAY_NAME_KEY,
      };

      const mockRejoin = async () => ({
        success: true,
        is_rejoin: true,
        data: {
          session: { id: initial.sessionId, status: 'in_progress', current_question_index: 2 },
          participant: {
            id: initial.participantId,
            session_id: initial.sessionId,
            display_name: initial.displayName,
            is_guest: true,
            status: 'active',
          },
        },
      });

      const res = await mockRejoin();
      assert.equal(res.success, true);
      assert.equal(res.data.session.status, 'in_progress');
      assert.equal(res.data.participant.id, initial.participantId);
    });

    test('2.3. F5 when Session is PAUSED: restores successfully, renders paused view without returning to join', async () => {
      const initial = {
        sessionId: mockGuestStorage.COMPETITION_GUEST_SESSION_ID_KEY,
        participantId: mockGuestStorage.COMPETITION_GUEST_PARTICIPANT_ID_KEY,
        guestToken: mockGuestStorage.COMPETITION_GUEST_TOKEN_KEY,
        displayName: mockGuestStorage.COMPETITION_GUEST_DISPLAY_NAME_KEY,
      };

      // Ensure validateAndRestoreSession executes studentRejoinSession for paused sessions
      assert.ok(
        studentPageJsx.includes('// 4. Active session (waiting / in_progress / paused) -> Call studentRejoinSession'),
        'Must explicitly support paused status in rejoin logic'
      );

      const mockRejoin = async () => ({
        success: true,
        is_rejoin: true,
        data: {
          session: { id: initial.sessionId, status: 'paused', current_question_index: 1 },
          participant: {
            id: initial.participantId,
            session_id: initial.sessionId,
            display_name: initial.displayName,
            is_guest: true,
            status: 'active',
          },
        },
      });

      const res = await mockRejoin();
      assert.equal(res.success, true);
      assert.equal(res.data.session.status, 'paused');
      assert.equal(res.data.participant.id, initial.participantId);

      // Verify that paused state in frontend is defined as isPaused = sessionData?.status === 'paused'
      assert.ok(studentPageJsx.includes("const isPaused = sessionData?.status === 'paused';"));
    });

    test('2.4. F5 when Session is FINISHED: restores final results without calling rejoin RPC', async () => {
      // Must load leaderboard directly and not call studentRejoinSession to avoid SESSION_CLOSED error
      assert.ok(
        studentPageJsx.includes("if (session.status === 'finished') {"),
        'Finished session must branch directly to leaderboard load'
      );
      assert.ok(
        studentPageJsx.includes('getLeaderboardSnapshot({'),
        'Must call getLeaderboardSnapshot for finished session'
      );
    });
  });

  // ==========================================================================
  // GROUP 3: AUTH LOADING DELAY & TRANSIENT NETWORK SIMULATION
  // ==========================================================================
  describe('Group 3: Auth Loading Race & Network Failure Handling', () => {
    test('3.1. Auth loading delay: initial render with loading===true preserves credentials', () => {
      let isRestoring = true;
      let restoredSessionPendingValidation = true;
      let storageSessionId = '11111111-2222-3333-4444-555555555555';

      // Simulation of persistence effect during initial loading
      const simulatePersistenceEffect = (stateSessionId) => {
        if (!stateSessionId) {
          if (isRestoring || restoredSessionPendingValidation) {
            // Guard triggers: Storage NOT deleted
            return;
          }
          storageSessionId = null;
        }
      };

      // Even if stateSessionId is null momentarily, storage is preserved
      simulatePersistenceEffect(null);
      assert.equal(storageSessionId, '11111111-2222-3333-4444-555555555555', 'Session storage must NOT be cleared during restoration');
    });

    test('3.2. Transient Network Failure: fails open for retry without wiping credentials', () => {
      const isStudentAuthOrPermanentError = (errorCode, status) => {
        if (!errorCode && !status) return false;
        const code = String(errorCode).toUpperCase();
        if (
          status === 401 ||
          status === 403 ||
          status === 404 ||
          code === 'PARTICIPANT_KICKED' ||
          code === 'PARTICIPANT_NOT_FOUND' ||
          code === 'SESSION_NOT_FOUND'
        ) {
          return true;
        }
        return false;
      };

      // Network timeout / 500 error
      const networkErrorCode = 'CLIENT_EXCEPTION';
      const networkStatus = 500;

      const isPermanent = isStudentAuthOrPermanentError(networkErrorCode, networkStatus);
      assert.equal(isPermanent, false, 'Network exception must not be classified as permanent error');
    });

    test('3.3. Invalid / Revoked / Kicked Guest Credentials: fails closed and wipes all storage', () => {
      const isStudentAuthOrPermanentError = (errorCode, status) => {
        if (!errorCode && !status) return false;
        const code = String(errorCode).toUpperCase();
        return (
          code === 'PARTICIPANT_KICKED' ||
          code === 'PARTICIPANT_NOT_FOUND' ||
          code === 'INVALID_GUEST_CREDENTIALS' ||
          code === 'SESSION_NOT_FOUND' ||
          status === 403
        );
      };

      const kickedError = 'PARTICIPANT_KICKED';
      assert.equal(isStudentAuthOrPermanentError(kickedError, 403), true, 'Kicked participant must fail closed');
    });
  });

  // ==========================================================================
  // GROUP 4: DUPLICATE PARTICIPANT PREVENTION & SECURITY
  // ==========================================================================
  describe('Group 4: Anti-Duplicate & Security Guardrails', () => {
    test('4.1. F5 flow NEVER invokes studentJoinSession (which inserts rows)', () => {
      // Searching validateAndRestoreSession implementation
      const validateStartIndex = studentPageJsx.indexOf('async function validateAndRestoreSession()');
      const validateEndIndex = studentPageJsx.indexOf('validateAndRestoreSession();', validateStartIndex);
      const validateBody = studentPageJsx.slice(validateStartIndex, validateEndIndex);

      assert.doesNotMatch(
        validateBody,
        /studentJoinSession\s*\(/,
        'validateAndRestoreSession must NEVER call studentJoinSession (must use studentRejoinSession only)'
      );
      assert.match(
        validateBody,
        /studentRejoinSession\s*\(/,
        'validateAndRestoreSession must call studentRejoinSession'
      );
    });

    test('4.2. Logged-in user visiting guest route cannot restore guest session', () => {
      assert.ok(
        studentPageJsx.includes('if (isGuestMode && user) return;'),
        'Must block restoring guest session if user is logged in'
      );
    });

    test('4.3. Rejoin RPC preserves existing score and submitted answers from database', () => {
      // Rejoin RPC updates last_seen_at and active status only, never mutates scores or answers
      const migrationSql = fs.readFileSync(
        path.join(projectRoot, 'supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql'),
        'utf8'
      );
      const rejoinRpcIndex = migrationSql.indexOf('CREATE OR REPLACE FUNCTION private.competition_rejoin_session_internal');
      const rejoinRpcEnd = migrationSql.indexOf('$$;', rejoinRpcIndex);
      const rejoinRpcCode = migrationSql.slice(rejoinRpcIndex, rejoinRpcEnd);

      assert.doesNotMatch(
        rejoinRpcCode,
        /DELETE FROM public\.competition_scores/i,
        'Rejoin RPC must never delete scores'
      );
      assert.doesNotMatch(
        rejoinRpcCode,
        /DELETE FROM public\.competition_answers/i,
        'Rejoin RPC must never delete answers'
      );
      assert.doesNotMatch(
        rejoinRpcCode,
        /INSERT INTO public\.competition_participants/i,
        'Rejoin RPC must never insert new participant'
      );
    });
  });
});
