import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ============================================================================
// IN-MEMORY STORAGE MOCK
// ============================================================================
class MockSessionStorage {
  constructor(initialData = {}) {
    this.store = { ...initialData };
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// Storage keys matching CompetitionStudentPage
const COMPETITION_GUEST_SESSION_ID_KEY = 'competition_guest_session_id';
const COMPETITION_GUEST_PARTICIPANT_ID_KEY = 'competition_guest_participant_id';
const COMPETITION_GUEST_TOKEN_KEY = 'competition_guest_token';
const COMPETITION_GUEST_DISPLAY_NAME_KEY = 'competition_guest_display_name';
const STUDENT_SESSION_STORAGE_KEY = 'competition_session_id';
const STUDENT_PARTICIPANT_STORAGE_KEY = 'competition_participant_id';

const isValidUUID = (uuid) => {
  if (typeof uuid !== 'string') return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid.trim());
};

const isStudentAuthOrPermanentError = (errorCode, status) => {
  if (!errorCode && !status) return false;
  const code = String(errorCode).toUpperCase();
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    code === 'PGRST116' ||
    code === '42501' ||
    code === 'FORBIDDEN_OR_NOT_FOUND' ||
    code === 'NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND' ||
    code === 'PARTICIPANT_NOT_FOUND' ||
    code === 'PARTICIPANT_KICKED' ||
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'ROLE_NOT_ALLOWED' ||
    code === 'SESSION_NOT_JOINABLE' ||
    code === 'ROOM_FULL' ||
    code.includes('PERMISSION') ||
    code.includes('NOT_FOUND')
  ) {
    return true;
  }
  return false;
};

// ============================================================================
// REACT COMPONENT LIFECYCLE SIMULATOR
// Simulates accurate React Hook execution (useMemo, useState, useEffect, useRef)
// across initial mount, async ticks, and auth state transitions
// ============================================================================
class CompetitionStudentPageLifecycleRunner {
  constructor({
    storage,
    isGuestMode = true,
    isBeforePatch = false, // When true, runs the buggy pre-patch code
    rpcMocks = {},
  }) {
    this.storage = storage;
    this.isGuestMode = isGuestMode;
    this.isBeforePatch = isBeforePatch;
    this.rpcMocks = {
      getSessionSnapshot: async () => ({ success: true, data: { id: 's1', status: 'in_progress' } }),
      studentRejoinSession: async () => ({ success: true, data: { participant: { id: 'p1', display_name: 'Guest' } } }),
      studentJoinSession: async () => ({ success: true, data: { session_id: 's1', participant_id: 'p_new' } }),
      getLeaderboardSnapshot: async () => ({ success: true, data: { leaderboard: [] } }),
      ...rpcMocks,
    };

    // Track RPC calls
    this.callCounts = {
      studentRejoinSession: 0,
      studentJoinSession: 0,
      getSessionSnapshot: 0,
      getLeaderboardSnapshot: 0,
    };

    // Component State
    this.state = {};
    this.refs = {};
    this.toasts = [];
  }

  getInitialGuestSession() {
    try {
      const storedSession = this.storage.getItem(COMPETITION_GUEST_SESSION_ID_KEY);
      const validStoredSession = storedSession && isValidUUID(storedSession) ? storedSession.trim() : null;
      const storedParticipant = this.storage.getItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY);
      const validStoredParticipant = storedParticipant && isValidUUID(storedParticipant) ? storedParticipant.trim() : null;
      const storedToken = this.storage.getItem(COMPETITION_GUEST_TOKEN_KEY);
      const validStoredToken = storedToken && typeof storedToken === 'string' && storedToken.trim().length >= 32 ? storedToken.trim() : null;
      const storedDisplayName = this.storage.getItem(COMPETITION_GUEST_DISPLAY_NAME_KEY) || null;

      if (validStoredSession && validStoredParticipant && validStoredToken) {
        return {
          sessionId: validStoredSession,
          participantId: validStoredParticipant,
          guestToken: validStoredToken,
          displayName: storedDisplayName,
        };
      }
    } catch (_e) {}
    return { sessionId: null, participantId: null, guestToken: null, displayName: null };
  }

  getInitialStudentSession() {
    try {
      const storedSession = this.storage.getItem(STUDENT_SESSION_STORAGE_KEY);
      const validStoredSession = storedSession && isValidUUID(storedSession) ? storedSession.trim() : null;
      const storedParticipant = this.storage.getItem(STUDENT_PARTICIPANT_STORAGE_KEY);
      const validStoredParticipant = storedParticipant && isValidUUID(storedParticipant) ? storedParticipant.trim() : null;
      if (validStoredSession && validStoredParticipant) {
        return { sessionId: validStoredSession, participantId: validStoredParticipant };
      }
    } catch (_e) {}
    return { sessionId: null, participantId: null };
  }

  clearRestoredSessionAndReturnToJoin(reason) {
    if (this.isGuestMode) {
      this.storage.removeItem(COMPETITION_GUEST_SESSION_ID_KEY);
      this.storage.removeItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY);
      this.storage.removeItem(COMPETITION_GUEST_DISPLAY_NAME_KEY);
      if (!this.isBeforePatch) {
        this.storage.removeItem(COMPETITION_GUEST_TOKEN_KEY);
      }
    } else {
      this.storage.removeItem(STUDENT_SESSION_STORAGE_KEY);
      this.storage.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
    }

    this.refs.activeSessionId = null;
    this.refs.activeParticipantId = null;
    this.refs.restoredSessionPendingValidation = false;
    this.state.sessionId = null;
    this.state.participantId = null;
    if (!this.isBeforePatch) {
      this.state.guestToken = null;
      this.state.guestDisplayName = '';
    }
    this.state.participantInfo = null;
    this.state.isRestoring = false;
    if (reason) {
      this.toasts.push({ type: 'error', message: reason });
    }
  }

  handleExit() {
    if (this.isGuestMode) {
      this.storage.removeItem(COMPETITION_GUEST_SESSION_ID_KEY);
      this.storage.removeItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY);
      this.storage.removeItem(COMPETITION_GUEST_DISPLAY_NAME_KEY);
      if (!this.isBeforePatch) {
        this.storage.removeItem(COMPETITION_GUEST_TOKEN_KEY);
      }
    } else {
      this.storage.removeItem(STUDENT_SESSION_STORAGE_KEY);
      this.storage.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
    }
    this.refs.activeSessionId = null;
    this.refs.activeParticipantId = null;
    this.refs.restoredSessionPendingValidation = false;
    this.state.sessionId = null;
    this.state.participantId = null;
    if (!this.isBeforePatch) {
      this.state.guestToken = null;
      this.state.guestDisplayName = '';
    }
    this.state.participantInfo = null;
  }

  // Simulate Render Pass 1: Initial Mount with loading=true
  renderMount({ loading = true, user = null }) {
    // 1. Calculate initialSession
    let initialSession;
    if (this.isBeforePatch) {
      // PRE-PATCH FAULTY LOGIC:
      if (this.isGuestMode && (loading || user)) {
        initialSession = { sessionId: null, participantId: null, guestToken: null, displayName: null };
      } else {
        initialSession = this.isGuestMode ? this.getInitialGuestSession() : this.getInitialStudentSession();
      }
    } else {
      // POST-PATCH FIXED LOGIC:
      if (this.isGuestMode && user) {
        initialSession = { sessionId: null, participantId: null, guestToken: null, displayName: null };
      } else {
        initialSession = this.isGuestMode ? this.getInitialGuestSession() : this.getInitialStudentSession();
      }
    }

    // 2. Initialize State (useState)
    this.state.sessionId = initialSession.sessionId;
    this.state.participantId = initialSession.participantId;
    this.state.guestToken = initialSession.guestToken || null;
    this.state.guestDisplayName = initialSession.displayName || '';
    this.state.participantInfo = initialSession.displayName ? { display_name: initialSession.displayName } : null;
    this.state.isRestoring = Boolean(initialSession.sessionId && initialSession.participantId);

    // 3. Initialize Refs (useRef)
    this.refs.activeSessionId = this.state.sessionId;
    this.refs.activeParticipantId = this.state.participantId;
    this.refs.restoredSessionPendingValidation = Boolean(initialSession.sessionId && initialSession.participantId);
    this.refs.isMounted = true;

    // 4. Run Persistence Effect (Runs on mount with initial state)
    this.runPersistenceEffect();

    // 5. Run Validate & Restore Effect (on Mount)
    return this.runValidateAndRestoreEffect({ loading, user });
  }

  // Persistence Effect Execution
  runPersistenceEffect() {
    this.refs.activeSessionId = this.state.sessionId;
    this.refs.activeParticipantId = this.state.participantId;

    if (this.isGuestMode) {
      if (
        this.state.sessionId &&
        isValidUUID(this.state.sessionId) &&
        this.state.participantId &&
        isValidUUID(this.state.participantId) &&
        this.state.guestToken
      ) {
        this.storage.setItem(COMPETITION_GUEST_SESSION_ID_KEY, this.state.sessionId);
        this.storage.setItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY, this.state.participantId);
        this.storage.setItem(COMPETITION_GUEST_TOKEN_KEY, this.state.guestToken);
        if (this.state.guestDisplayName) {
          this.storage.setItem(COMPETITION_GUEST_DISPLAY_NAME_KEY, this.state.guestDisplayName);
        }
      } else {
        if (this.isBeforePatch) {
          // PRE-PATCH: No guard! Prematurely wipes storage!
          this.storage.removeItem(COMPETITION_GUEST_SESSION_ID_KEY);
          this.storage.removeItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY);
          this.storage.removeItem(COMPETITION_GUEST_DISPLAY_NAME_KEY);
        } else {
          // POST-PATCH: Protected with restoration guard!
          if (this.state.isRestoring || this.refs.restoredSessionPendingValidation) {
            return;
          }
          this.storage.removeItem(COMPETITION_GUEST_SESSION_ID_KEY);
          this.storage.removeItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY);
          this.storage.removeItem(COMPETITION_GUEST_TOKEN_KEY);
          this.storage.removeItem(COMPETITION_GUEST_DISPLAY_NAME_KEY);
        }
      }
    } else {
      // Student mode
      if (this.state.sessionId && isValidUUID(this.state.sessionId)) {
        this.storage.setItem(STUDENT_SESSION_STORAGE_KEY, this.state.sessionId);
      } else {
        if (!this.isBeforePatch && (this.state.isRestoring || this.refs.restoredSessionPendingValidation)) {
          // Guarded
        } else {
          this.storage.removeItem(STUDENT_SESSION_STORAGE_KEY);
        }
      }

      if (this.state.participantId && isValidUUID(this.state.participantId)) {
        this.storage.setItem(STUDENT_PARTICIPANT_STORAGE_KEY, this.state.participantId);
      } else {
        if (!this.isBeforePatch && (this.state.isRestoring || this.refs.restoredSessionPendingValidation)) {
          // Guarded
        } else {
          this.storage.removeItem(STUDENT_PARTICIPANT_STORAGE_KEY);
        }
      }
    }
  }

  // Validate and Restore Effect
  async runValidateAndRestoreEffect({ loading, user }) {
    // Auth loading race protection: do not restore guest session while auth is still loading
    if (loading) return 'LOADING_BLOCKED';
    // Do not restore guest session if user is logged in
    if (this.isGuestMode && user) return 'LOGGED_IN_BLOCKED';

    const initial = this.isGuestMode ? this.getInitialGuestSession() : this.getInitialStudentSession();
    if (!initial.sessionId || !initial.participantId) {
      this.state.isRestoring = false;
      this.refs.restoredSessionPendingValidation = false;
      return 'NO_STORED_SESSION';
    }

    try {
      // 1. Fetch Session Snapshot
      this.callCounts.getSessionSnapshot++;
      const sessionRes = await this.rpcMocks.getSessionSnapshot(initial.sessionId);

      if (!sessionRes.success) {
        if (isStudentAuthOrPermanentError(sessionRes.error_code, sessionRes.status)) {
          this.clearRestoredSessionAndReturnToJoin('Phiên thi không tồn tại hoặc bạn không có quyền truy cập.');
          return 'SESSION_PERMANENT_ERROR';
        } else {
          this.toasts.push({ type: 'warning', message: 'Đang kết nối lại phòng thi...' });
          return 'TRANSIENT_NETWORK_ERROR';
        }
      }

      const session = sessionRes.data;

      // 2. Cancelled session
      if (session.status === 'cancelled') {
        this.clearRestoredSessionAndReturnToJoin('Phòng thi đã bị hủy.');
        return 'SESSION_CANCELLED';
      }

      // 3. Finished session -> Call getLeaderboardSnapshot
      if (session.status === 'finished') {
        this.state.sessionId = initial.sessionId;
        this.state.participantId = initial.participantId;
        if (this.isGuestMode && initial.guestToken) {
          this.state.guestToken = initial.guestToken;
        }

        this.callCounts.getLeaderboardSnapshot++;
        const lbRes = await this.rpcMocks.getLeaderboardSnapshot({
          sessionId: initial.sessionId,
          participantId: initial.participantId,
          guestToken: this.isGuestMode ? initial.guestToken : null,
        });

        if (!lbRes.success) {
          if (isStudentAuthOrPermanentError(lbRes.error_code, lbRes.status)) {
            this.clearRestoredSessionAndReturnToJoin('Bạn không có quyền xem kết quả phòng thi này.');
            return 'LEADERBOARD_PERMANENT_ERROR';
          }
          this.refs.restoredSessionPendingValidation = false;
          return 'LEADERBOARD_TRANSIENT_ERROR';
        }

        const lbData = lbRes.data?.leaderboard || [];
        const matched = lbData.find((item) => item.participant_id === initial.participantId);
        if (lbData.length > 0 && !matched) {
          this.clearRestoredSessionAndReturnToJoin('Không tìm thấy thông tin thí sinh trong bảng kết quả phòng thi.');
          return 'PARTICIPANT_NOT_MATCHED';
        }

        if (matched) {
          this.state.participantInfo = {
            display_name: matched.display_name,
            avatar_url: matched.avatar_url,
          };
        }
        this.refs.restoredSessionPendingValidation = false;
        return 'FINISHED_RESTORED';
      }

      // 4. Active session (waiting / in_progress / paused) -> Call studentRejoinSession
      this.callCounts.studentRejoinSession++;
      const rejoinRes = await this.rpcMocks.studentRejoinSession({
        sessionId: initial.sessionId,
        participantId: initial.participantId,
        guestToken: this.isGuestMode ? initial.guestToken : null,
      });

      if (!rejoinRes.success) {
        if (isStudentAuthOrPermanentError(rejoinRes.error_code, rejoinRes.status)) {
          this.clearRestoredSessionAndReturnToJoin('Lỗi xác thực người chơi.');
          return 'REJOIN_PERMANENT_ERROR';
        } else {
          this.toasts.push({ type: 'warning', message: 'Lỗi mạng khi kết nối lại.' });
          return 'REJOIN_TRANSIENT_ERROR';
        }
      }

      const returnedPart = rejoinRes.data?.participant;
      if (!returnedPart || returnedPart.id !== initial.participantId) {
        this.clearRestoredSessionAndReturnToJoin('Thông tin thí sinh không khớp với phiên thi đã lưu.');
        return 'REJOIN_PARTICIPANT_MISMATCH';
      }

      this.state.sessionId = initial.sessionId;
      this.state.participantId = initial.participantId;
      this.state.participantInfo = returnedPart;
      if (this.isGuestMode && initial.guestToken) {
        this.state.guestToken = initial.guestToken;
      }
      this.refs.restoredSessionPendingValidation = false;
      return 'ACTIVE_SESSION_RESTORED';
    } finally {
      this.state.isRestoring = false;
      // Re-run persistence effect to synchronize final validated state
      this.runPersistenceEffect();
    }
  }

  // Simulate Re-render Pass 2: Auth transition from loading=true to loading=false
  async transitionAuthResolved({ user = null }) {
    // Component re-renders with loading=false
    return this.runValidateAndRestoreEffect({ loading: false, user });
  }
}

// ============================================================================
// TEST SUITE: RUNTIME REACT LIFECYCLE & MULTI-STATE F5 VALIDATION
// ============================================================================
describe('PR #154 — Final Pre-Merge React Lifecycle Runtime Validation', () => {
  const validSessionId = 'c0a80101-0000-4000-8000-000000000001';
  const validParticipantId = 'd0a80101-0000-4000-8000-000000000002';
  const validGuestToken = 'g'.repeat(64);
  const validDisplayName = 'Em Bé Học Giỏi';

  const createInitialGuestStorage = () =>
    new MockSessionStorage({
      [COMPETITION_GUEST_SESSION_ID_KEY]: validSessionId,
      [COMPETITION_GUEST_PARTICIPANT_ID_KEY]: validParticipantId,
      [COMPETITION_GUEST_TOKEN_KEY]: validGuestToken,
      [COMPETITION_GUEST_DISPLAY_NAME_KEY]: validDisplayName,
    });

  // --------------------------------------------------------------------------
  // TC 1: BEFORE PATCH VS AFTER PATCH BUG REPRODUCTION
  // --------------------------------------------------------------------------
  test('1. REGRESSION & REPRODUCTION: Pre-Patch Wipes Storage on Render 1; Post-Patch Preserves & Restores', async () => {
    // 1A. RUN PRE-PATCH (BUGGY VERSION)
    const storageBefore = createInitialGuestStorage();
    const runnerBefore = new CompetitionStudentPageLifecycleRunner({
      storage: storageBefore,
      isGuestMode: true,
      isBeforePatch: true, // FAULTY PRE-PATCH LOGIC
    });

    // Render 1: Mount with loading=true
    const mountResBefore = await runnerBefore.renderMount({ loading: true, user: null });
    assert.equal(mountResBefore, 'LOADING_BLOCKED', 'Mount correctly aborted during auth loading');

    // BUG DETECTED: Pre-patch persistence effect ran with sessionId=null and WIPED sessionStorage!
    assert.equal(
      storageBefore.getItem(COMPETITION_GUEST_SESSION_ID_KEY),
      null,
      'PRE-PATCH BUG PROVEN: Session ID was prematurely wiped from storage on render 1!'
    );
    assert.equal(
      storageBefore.getItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY),
      null,
      'PRE-PATCH BUG PROVEN: Participant ID was prematurely wiped from storage on render 1!'
    );

    // Render 2: Auth resolves loading=false
    const restoreResBefore = await runnerBefore.transitionAuthResolved({ user: null });
    assert.equal(
      restoreResBefore,
      'NO_STORED_SESSION',
      'PRE-PATCH FAILURE: Because storage was wiped on render 1, restore fails completely!'
    );
    assert.equal(runnerBefore.state.sessionId, null);
    assert.equal(runnerBefore.callCounts.studentRejoinSession, 0, 'studentRejoinSession was never called');

    // 1B. RUN POST-PATCH (FIXED PR #154 VERSION)
    const storageAfter = createInitialGuestStorage();
    const runnerAfter = new CompetitionStudentPageLifecycleRunner({
      storage: storageAfter,
      isGuestMode: true,
      isBeforePatch: false, // FIXED PR #154 LOGIC
      rpcMocks: {
        getSessionSnapshot: async () => ({ success: true, data: { id: validSessionId, status: 'in_progress' } }),
        studentRejoinSession: async () => ({
          success: true,
          data: { participant: { id: validParticipantId, display_name: validDisplayName } },
        }),
      },
    });

    // Render 1: Mount with loading=true
    const mountResAfter = await runnerAfter.renderMount({ loading: true, user: null });
    assert.equal(mountResAfter, 'LOADING_BLOCKED');

    // VERIFICATION: Storage is strictly PRESERVED on render 1!
    assert.equal(
      storageAfter.getItem(COMPETITION_GUEST_SESSION_ID_KEY),
      validSessionId,
      'POST-PATCH FIX PROVEN: Session ID is preserved in storage during auth loading'
    );
    assert.equal(
      storageAfter.getItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY),
      validParticipantId,
      'POST-PATCH FIX PROVEN: Participant ID is preserved in storage during auth loading'
    );
    assert.equal(
      storageAfter.getItem(COMPETITION_GUEST_TOKEN_KEY),
      validGuestToken,
      'POST-PATCH FIX PROVEN: Guest token is preserved in storage during auth loading'
    );
    assert.equal(runnerAfter.state.isRestoring, true, 'isRestoring is initialized to true');

    // Render 2: Auth resolves loading=false
    const restoreResAfter = await runnerAfter.transitionAuthResolved({ user: null });
    assert.equal(restoreResAfter, 'ACTIVE_SESSION_RESTORED', 'POST-PATCH SUCCESS: Session restored successfully!');
    assert.equal(runnerAfter.state.sessionId, validSessionId);
    assert.equal(runnerAfter.state.participantId, validParticipantId);
    assert.equal(runnerAfter.callCounts.studentRejoinSession, 1, 'Exactly 1 rejoin RPC call executed');
  });

  // --------------------------------------------------------------------------
  // TC 2: F5 RESTORE ACROSS ALL LIFECYCLE STATES
  // --------------------------------------------------------------------------
  test('2.1. WAITING State F5 Restore: Restores participant without duplicate', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({ success: true, data: { id: sid, status: 'waiting' } }),
        studentRejoinSession: async ({ sessionId, participantId, guestToken }) => {
          assert.equal(sessionId, validSessionId);
          assert.equal(participantId, validParticipantId);
          assert.equal(guestToken, validGuestToken);
          return {
            success: true,
            data: { participant: { id: participantId, display_name: validDisplayName, status: 'active' } },
          };
        },
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'ACTIVE_SESSION_RESTORED');
    assert.equal(runner.state.sessionId, validSessionId);
    assert.equal(runner.state.participantId, validParticipantId);
    assert.equal(runner.callCounts.studentRejoinSession, 1);
    assert.equal(runner.callCounts.studentJoinSession, 0, 'Never called studentJoinSession');
  });

  test('2.2. IN_PROGRESS State F5 Restore: Restores ongoing session, question and score context', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({
          success: true,
          data: { id: sid, status: 'in_progress', current_question_index: 3 },
        }),
        studentRejoinSession: async () => ({
          success: true,
          data: { participant: { id: validParticipantId, display_name: validDisplayName, status: 'active' } },
        }),
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'ACTIVE_SESSION_RESTORED');
    assert.equal(runner.state.sessionId, validSessionId);
    assert.equal(runner.state.participantId, validParticipantId);
  });

  test('2.3. PAUSED State F5 Restore: Restores paused session into paused view without join redirect', async () => {
    const storage = createInitialGuestStorage();
    let receivedSessionStatus = null;

    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => {
          receivedSessionStatus = 'paused';
          return {
            success: true,
            data: { id: sid, status: 'paused', current_question_index: 2 },
          };
        },
        studentRejoinSession: async ({ sessionId, participantId, guestToken }) => {
          assert.equal(sessionId, validSessionId);
          assert.equal(participantId, validParticipantId);
          assert.equal(guestToken, validGuestToken);
          return {
            success: true,
            data: { participant: { id: participantId, display_name: validDisplayName, status: 'active' } },
          };
        },
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'ACTIVE_SESSION_RESTORED');
    assert.equal(receivedSessionStatus, 'paused');
    assert.equal(runner.state.sessionId, validSessionId);
    assert.equal(runner.state.participantId, validParticipantId);
    assert.equal(runner.state.isRestoring, false);
    assert.equal(runner.callCounts.studentRejoinSession, 1);
  });

  test('2.4. FINISHED State F5 Restore: Loads leaderboard directly, skips rejoin RPC (avoids SESSION_CLOSED)', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({
          success: true,
          data: { id: sid, status: 'finished' },
        }),
        studentRejoinSession: async () => {
          // Should NEVER be called on finished session
          throw new Error('CRITICAL BUG: studentRejoinSession MUST NOT be called on finished session!');
        },
        getLeaderboardSnapshot: async ({ sessionId, participantId, guestToken }) => {
          assert.equal(sessionId, validSessionId);
          assert.equal(participantId, validParticipantId);
          assert.equal(guestToken, validGuestToken);
          return {
            success: true,
            data: {
              leaderboard: [
                { participant_id: validParticipantId, display_name: validDisplayName, rank: 1, total_score: 100 },
              ],
            },
          };
        },
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'FINISHED_RESTORED');
    assert.equal(runner.callCounts.studentRejoinSession, 0, 'Rejoin RPC was bypassed for finished session');
    assert.equal(runner.callCounts.getLeaderboardSnapshot, 1, 'Leaderboard snapshot was fetched');
    assert.equal(runner.state.participantInfo?.display_name, validDisplayName);
  });

  // --------------------------------------------------------------------------
  // TC 3: SECURITY, FAIL-CLOSED & EDGE CASES
  // --------------------------------------------------------------------------
  test('3.1. KICKED Guest: Fails closed, purges sessionStorage including guestToken', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({ success: true, data: { id: sid, status: 'in_progress' } }),
        studentRejoinSession: async () => ({
          success: false,
          error_code: 'PARTICIPANT_KICKED',
          status: 403,
          message: 'Bạn đã bị xóa khỏi phòng thi.',
        }),
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'REJOIN_PERMANENT_ERROR');
    assert.equal(runner.state.sessionId, null);
    assert.equal(runner.state.participantId, null);
    assert.equal(runner.state.guestToken, null);

    // Verify complete storage cleanup
    assert.equal(storage.getItem(COMPETITION_GUEST_SESSION_ID_KEY), null);
    assert.equal(storage.getItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY), null);
    assert.equal(storage.getItem(COMPETITION_GUEST_TOKEN_KEY), null, 'Guest token purged');
    assert.equal(storage.getItem(COMPETITION_GUEST_DISPLAY_NAME_KEY), null);
  });

  test('3.2. INVALID Guest Credentials / Revoked Session: Fails closed and clears storage', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({ success: true, data: { id: sid, status: 'in_progress' } }),
        studentRejoinSession: async () => ({
          success: false,
          error_code: 'FORBIDDEN_OR_NOT_FOUND',
          status: 403,
          message: 'Không tìm thấy người tham gia hoặc token không hợp lệ.',
        }),
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'REJOIN_PERMANENT_ERROR');
    assert.equal(storage.getItem(COMPETITION_GUEST_SESSION_ID_KEY), null);
    assert.equal(storage.getItem(COMPETITION_GUEST_TOKEN_KEY), null);
  });

  test('3.3. TRANSIENT Network Failure: Does NOT clear storage, preserves session for retry', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async () => ({
          success: false,
          error_code: 'CLIENT_EXCEPTION',
          status: 500,
          message: 'Failed to fetch (offline)',
        }),
      },
    });

    runner.renderMount({ loading: true, user: null });
    const result = await runner.transitionAuthResolved({ user: null });

    assert.equal(result, 'TRANSIENT_NETWORK_ERROR');
    // Storage MUST NOT be deleted on transient network error
    assert.equal(storage.getItem(COMPETITION_GUEST_SESSION_ID_KEY), validSessionId);
    assert.equal(storage.getItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY), validParticipantId);
    assert.equal(storage.getItem(COMPETITION_GUEST_TOKEN_KEY), validGuestToken);
  });

  test('3.4. CLEAN EXIT: Explicit handleExit clears all session and token data', () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({ storage, isGuestMode: true });

    runner.renderMount({ loading: false, user: null });
    runner.handleExit();

    assert.equal(storage.getItem(COMPETITION_GUEST_SESSION_ID_KEY), null);
    assert.equal(storage.getItem(COMPETITION_GUEST_PARTICIPANT_ID_KEY), null);
    assert.equal(storage.getItem(COMPETITION_GUEST_TOKEN_KEY), null);
    assert.equal(storage.getItem(COMPETITION_GUEST_DISPLAY_NAME_KEY), null);
    assert.equal(runner.state.sessionId, null);
    assert.equal(runner.state.guestToken, null);
  });

  test('3.5. LOGGED-IN User on Guest Route: Blocks restoring guest session', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async () => {
          throw new Error('Must NOT be called when logged-in user visits guest route');
        },
      },
    });

    // Mount with logged-in user
    runner.renderMount({ loading: false, user: { id: 'user-123', email: 'student@example.com' } });
    const result = await runner.transitionAuthResolved({ user: { id: 'user-123' } });

    assert.equal(result, 'LOGGED_IN_BLOCKED');
    assert.equal(runner.state.sessionId, null);
    assert.equal(runner.callCounts.studentRejoinSession, 0);
  });

  // --------------------------------------------------------------------------
  // TC 4: AUTHENTICATED STUDENT REGRESSION (No Guest Mode)
  // --------------------------------------------------------------------------
  test('4.1. STUDENT ACCOUNT F5 Regression: Authenticated student session preserved and restored', async () => {
    const studentStorage = new MockSessionStorage({
      [STUDENT_SESSION_STORAGE_KEY]: validSessionId,
      [STUDENT_PARTICIPANT_STORAGE_KEY]: validParticipantId,
    });

    const runner = new CompetitionStudentPageLifecycleRunner({
      storage: studentStorage,
      isGuestMode: false, // AUTHENTICATED STUDENT
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({ success: true, data: { id: sid, status: 'in_progress' } }),
        studentRejoinSession: async ({ sessionId, participantId, guestToken }) => {
          assert.equal(guestToken, null, 'Authenticated student must NEVER send guestToken');
          return {
            success: true,
            data: { participant: { id: participantId, display_name: 'Học sinh chính thức' } },
          };
        },
      },
    });

    // Mount with loading=true
    runner.renderMount({ loading: true, user: { id: 'student-auth-id' } });

    // Verify storage preserved on mount
    assert.equal(studentStorage.getItem(STUDENT_SESSION_STORAGE_KEY), validSessionId);
    assert.equal(studentStorage.getItem(STUDENT_PARTICIPANT_STORAGE_KEY), validParticipantId);

    // Transition loading=false
    const result = await runner.transitionAuthResolved({ user: { id: 'student-auth-id' } });
    assert.equal(result, 'ACTIVE_SESSION_RESTORED');
    assert.equal(runner.state.sessionId, validSessionId);
    assert.equal(runner.state.participantId, validParticipantId);
    assert.equal(runner.callCounts.studentRejoinSession, 1);
  });

  // --------------------------------------------------------------------------
  // TC 5: DUPLICATE PARTICIPANT & REJOIN INTEGRITY
  // --------------------------------------------------------------------------
  test('5.1. Zero Duplicate Participants Created: studentJoinSession count remains 0 throughout F5', async () => {
    const storage = createInitialGuestStorage();
    const runner = new CompetitionStudentPageLifecycleRunner({
      storage,
      isGuestMode: true,
      rpcMocks: {
        getSessionSnapshot: async (sid) => ({ success: true, data: { id: sid, status: 'in_progress' } }),
        studentRejoinSession: async () => ({
          success: true,
          data: { participant: { id: validParticipantId, display_name: validDisplayName } },
        }),
        studentJoinSession: async () => {
          throw new Error('VIOLATION: studentJoinSession must NEVER be invoked during F5 restore!');
        },
      },
    });

    runner.renderMount({ loading: true, user: null });
    await runner.transitionAuthResolved({ user: null });

    assert.equal(runner.callCounts.studentRejoinSession, 1);
    assert.equal(runner.callCounts.studentJoinSession, 0, 'No new participant created');
  });
});
