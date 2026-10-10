import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('COMPETITION V1 HOST CREATE SESSION — RESPONSE SHAPE REGRESSION TEST SUITE', async (t) => {
  const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
  const clientSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');

  // ==========================================================================
  // Group 1: Static Code Invariants in CompetitionHostPage.jsx
  // ==========================================================================
  await t.test('1. CompetitionHostPage extracts session ID supporting both session_id and session.id', () => {
    assert.match(
      hostPageSource,
      /res\.data\?\.session_id\s*\|\|\s*res\.data\?\.session\?\.id/,
      'CompetitionHostPage.jsx must extract newSessionId using res.data?.session_id || res.data?.session?.id'
    );
  });

  await t.test('2. CompetitionHostPage checks both res.success and newSessionId', () => {
    assert.match(
      hostPageSource,
      /if\s*\(\s*res\.success\s*&&\s*newSessionId\s*\)/,
      'CompetitionHostPage.jsx must gate success on res.success && newSessionId'
    );
  });

  await t.test('3. CompetitionHostPage does not strictly require res.data?.session?.id alone', () => {
    assert.doesNotMatch(
      hostPageSource,
      /if\s*\(\s*res\.success\s*&&\s*res\.data\?\.session\?\.id\s*\)/,
      'CompetitionHostPage.jsx must no longer require res.data?.session?.id as the sole condition'
    );
  });

  await t.test('4. CompetitionHostPage provides initialSnapshot supporting flat RPC response', () => {
    assert.ok(
      hostPageSource.includes('const initialSnapshot = res.data?.session || {') &&
      hostPageSource.includes('id: newSessionId') &&
      hostPageSource.includes('setSnapshot(initialSnapshot)'),
      'CompetitionHostPage.jsx must construct initialSnapshot when res.data.session is missing'
    );
  });

  await t.test('5. CompetitionHostPage preserves fail-closed error handling and setupError message', () => {
    assert.ok(
      hostPageSource.includes("setSetupError(res.message || 'Không thể tạo phòng thi. Vui lòng thử lại.')"),
      'CompetitionHostPage.jsx must preserve standard setupError fallback'
    );
  });

  // ==========================================================================
  // Group 2: Client Service Adapter Invariants in competitionClient.js
  // ==========================================================================
  await t.test('6. competitionClient hostCreateSession attaches session alias when RPC returns flat session_id', () => {
    assert.ok(
      clientSource.includes('normalized.data.session_id') &&
      clientSource.includes('normalized.data.session = {'),
      'competitionClient.js must attach session alias for backward compatibility when session_id is returned'
    );
  });

  // ==========================================================================
  // Group 3: Behavioral Simulation of Session Creation Flow
  // ==========================================================================
  const simulateHostCreateResponseHandling = (res, formData = { trimmedTitle: 'Đấu Trường V1', maxParticipants: 30, reviewEnabled: false, description: '' }) => {
    let activeSessionId = null;
    let setupError = null;
    let snapshot = null;
    let hostViewMode = 'SETUP';
    let toast = null;

    const newSessionId = res.data?.session_id || res.data?.session?.id;

    if (res.success && newSessionId) {
      activeSessionId = newSessionId;
      const initialSnapshot = res.data?.session || {
        id: newSessionId,
        room_code: res.data?.room_code,
        title: res.data?.title || formData.trimmedTitle,
        description: res.data?.description || formData.description.trim() || null,
        status: 'waiting',
        mode: res.data?.mode || 'individual',
        max_participants: res.data?.max_participants || parseInt(formData.maxParticipants, 10) || 30,
        current_question_index: 0,
        current_question_id: null,
        reward_enabled: res.data?.reward_enabled ?? Boolean(formData.reviewEnabled),
        review_enabled: res.data?.review_enabled ?? Boolean(formData.reviewEnabled)
      };
      snapshot = initialSnapshot;
      hostViewMode = 'LIVE_QUESTION';
      toast = 'Tạo phòng thi thành công! Mã phòng đã sẵn sàng.';
    } else {
      setupError = res.message || 'Không thể tạo phòng thi. Vui lòng thử lại.';
    }

    return { activeSessionId, setupError, snapshot, hostViewMode, toast };
  };

  await t.test('7. RPC success with flat session_id is recognized as success', () => {
    const canonicalRpcResponse = {
      success: true,
      data: {
        success: true,
        session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        room_code: 'HN8899',
        title: 'Đấu trường Toán lớp 5',
        mode: 'individual',
        max_participants: 50,
        question_count: 5,
        reward_enabled: false,
        review_enabled: true
      }
    };

    const state = simulateHostCreateResponseHandling(canonicalRpcResponse);
    assert.strictEqual(state.activeSessionId, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    assert.strictEqual(state.setupError, null);
    assert.strictEqual(state.hostViewMode, 'LIVE_QUESTION');
    assert.ok(state.snapshot);
    assert.strictEqual(state.snapshot.id, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    assert.strictEqual(state.snapshot.room_code, 'HN8899');
    assert.strictEqual(state.snapshot.status, 'waiting');
    assert.strictEqual(state.toast, 'Tạo phòng thi thành công! Mã phòng đã sẵn sàng.');
  });

  await t.test('8. Compatibility with nested session.id structure is preserved', () => {
    const legacyNestedResponse = {
      success: true,
      data: {
        success: true,
        session: {
          id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          room_code: 'KL1122',
          title: 'Đấu trường Tiếng Việt',
          status: 'waiting'
        }
      }
    };

    const state = simulateHostCreateResponseHandling(legacyNestedResponse);
    assert.strictEqual(state.activeSessionId, 'b2c3d4e5-f6a7-8901-bcde-f12345678901');
    assert.strictEqual(state.setupError, null);
    assert.strictEqual(state.hostViewMode, 'LIVE_QUESTION');
    assert.strictEqual(state.snapshot.id, 'b2c3d4e5-f6a7-8901-bcde-f12345678901');
    assert.strictEqual(state.snapshot.room_code, 'KL1122');
  });

  await t.test('9. RPC failure is never mistakenly recognized as success', () => {
    const failureResponse = {
      success: false,
      error_code: 'ROOM_CODE_GENERATION_FAILED',
      message: 'Mã phòng thi bị trùng lặp. Vui lòng thử lại.'
    };

    const state = simulateHostCreateResponseHandling(failureResponse);
    assert.strictEqual(state.activeSessionId, null);
    assert.strictEqual(state.snapshot, null);
    assert.strictEqual(state.hostViewMode, 'SETUP');
    assert.strictEqual(state.setupError, 'Mã phòng thi bị trùng lặp. Vui lòng thử lại.');
    assert.strictEqual(state.toast, null);
  });

  await t.test('10. Malformed success response missing session ID fails closed safely', () => {
    const malformedResponse = {
      success: true,
      data: {
        success: true,
        room_code: 'NOPID1'
      }
    };

    const state = simulateHostCreateResponseHandling(malformedResponse);
    assert.strictEqual(state.activeSessionId, null);
    assert.strictEqual(state.snapshot, null);
    assert.strictEqual(state.hostViewMode, 'SETUP');
    assert.strictEqual(state.setupError, 'Không thể tạo phòng thi. Vui lòng thử lại.');
    assert.strictEqual(state.toast, null);
  });

  await t.test('11. Empty response fails closed safely', () => {
    const emptyResponse = {
      success: false,
      error_code: 'EMPTY_RESPONSE',
      message: 'Không thể tạo phòng thi.'
    };

    const state = simulateHostCreateResponseHandling(emptyResponse);
    assert.strictEqual(state.activeSessionId, null);
    assert.strictEqual(state.setupError, 'Không thể tạo phòng thi.');
  });
});
