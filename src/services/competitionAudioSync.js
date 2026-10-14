import { DEFAULT_SESSION_AUDIO_CONFIG } from './competitionClient.js';

/**
 * Validates audio config structure.
 */
export const isValidAudioConfig = (cfg) => {
  if (!cfg || typeof cfg !== 'object') return false;
  if (!['in_class', 'online'].includes(cfg.mode)) return false;
  if (!['theme', 'custom'].includes(cfg.selection_mode)) return false;
  if (typeof cfg.theme_id !== 'string') return false;
  return true;
};

/**
 * Checks if actual audio config from DB matches requested config.
 */
export const isAudioConfigMatching = (actual, requested) => {
  if (!actual || typeof actual !== 'object' || !requested || typeof requested !== 'object') {
    return false;
  }
  return (
    actual.mode === requested.mode &&
    actual.selection_mode === requested.selection_mode &&
    actual.theme_id === requested.theme_id &&
    actual.custom_lobby_track_id === requested.custom_lobby_track_id &&
    actual.custom_question_track_id === requested.custom_question_track_id
  );
};

/**
 * Classifies snapshot state and determines next audio config status.
 * Pure function: zero side-effects, 100% testable in isolation.
 *
 * Distinguishes 3 situations:
 * 1. DB truly does NOT have audio_config row (legacy_missing).
 * 2. Query audio_config failed (401/403/500/network) -> query_error.
 * 3. Host is saving or retrying online configuration (pending save).
 *
 * Invariants:
 * - NEVER automatically writes DEFAULT_SESSION_AUDIO_CONFIG when query fails or pending save exists.
 * - NEVER overwrites Host's online choice.
 * - NEVER triggers an auto-retry loop.
 */
export function classifyAudioSnapshotState({
  snapshot,
  activeSessionId,
  currentStatus,
  pendingAudioConfig = null,
}) {
  // Guard 0: No active session
  if (!activeSessionId) {
    return {
      action: 'RESET_IDLE',
      nextStatus: 'idle',
      nextMode: null,
      nextError: null,
      shouldClearPending: true,
      shouldAutoHeal: false,
    };
  }

  // Guard 1: Stale snapshot from different session
  if (!snapshot || snapshot.id !== activeSessionId) {
    return {
      action: 'IGNORE_STALE_SESSION',
      nextStatus: null,
      nextMode: null,
      nextError: null,
      shouldClearPending: false,
      shouldAutoHeal: false,
    };
  }

  // Guard 2: Host save is in progress -> background polling MUST NEVER overwrite
  if (currentStatus === 'saving') {
    return {
      action: 'IGNORE_SAVING_IN_PROGRESS',
      nextStatus: null,
      nextMode: null,
      nextError: null,
      shouldClearPending: false,
      shouldAutoHeal: false,
    };
  }

  // Authoritative DB record exists
  if (snapshot.audio_config_persisted === true && isValidAudioConfig(snapshot.audio_config)) {
    // If Host has a pending save or retry, verify DB matches Host's requested config!
    if (pendingAudioConfig) {
      if (isAudioConfigMatching(snapshot.audio_config, pendingAudioConfig)) {
        return {
          action: 'MATCH_PENDING_CONFIRMED',
          nextStatus: 'saved',
          nextMode: snapshot.audio_config.mode,
          nextError: null,
          shouldClearPending: true,
          shouldAutoHeal: false,
        };
      } else {
        // DB row is different from Host's requested config (e.g. online requested, DB still in_class)
        // DO NOT mark saved! Keep error and preserve Host's selection!
        return {
          action: 'PENDING_CONFIG_MISMATCH',
          nextStatus: 'failed',
          nextMode: null, // do not overwrite Host's mode!
          nextError: 'Cấu hình âm thanh trên máy chủ chưa khớp với cấu hình đã chọn.',
          shouldClearPending: false, // keep pending config for Host retry
          shouldAutoHeal: false,
        };
      }
    }

    // No pending save (e.g. F5 reload, restore, or idle): trust DB record
    return {
      action: 'RESTORE_FROM_DB',
      nextStatus: 'saved',
      nextMode: snapshot.audio_config?.mode || 'in_class',
      nextError: null,
      shouldClearPending: true,
      shouldAutoHeal: false,
    };
  }

  // audio_config_persisted === false
  // Situation 2: Query failed (401/403/500/network)
  if (snapshot.audio_config_state === 'error' || Boolean(snapshot.audio_config_error)) {
    return {
      action: 'QUERY_ERROR',
      nextStatus: 'failed',
      nextMode: null, // Preserve Host's current selection!
      nextError: snapshot.audio_config_error || 'Lỗi kết nối khi tải cấu hình âm thanh từ máy chủ.',
      shouldClearPending: false, // Keep pending for retry!
      shouldAutoHeal: false, // STRICTLY PROHIBITED
    };
  }

  // Situation 3: Host has pending save, but DB row doesn't exist yet (waiting for save to land)
  if (pendingAudioConfig) {
    return {
      action: 'PENDING_SAVE_AWAITING_DB',
      nextStatus: 'failed',
      nextMode: null, // Preserve Host's requested online mode!
      nextError: 'Đang đợi cấu hình được lưu vào cơ sở dữ liệu...',
      shouldClearPending: false,
      shouldAutoHeal: false, // NEVER write default!
    };
  }

  // Situation 1: DB truly does NOT have audio_config row (Legacy R18 room)
  // snapshot.audio_config_state === 'missing' (or persisted === false and no error)
  if (snapshot.status === 'waiting') {
    return {
      action: 'LEGACY_MISSING_NEEDS_CONFIRMATION',
      nextStatus: 'legacy_missing',
      nextMode: 'in_class',
      nextError: 'Phòng thi từ phiên bản trước chưa có cấu hình âm thanh trong cơ sở dữ liệu.',
      shouldClearPending: false,
      shouldAutoHeal: false, // DO NOT AUTO-HEAL ON SNAPSHOT READ! Require Host confirmation!
    };
  }

  return {
    action: 'UNPERSISTED_NON_WAITING',
    nextStatus: 'failed',
    nextMode: null,
    nextError: 'Cấu hình âm thanh chưa được lưu vào cơ sở dữ liệu.',
    shouldClearPending: false,
    shouldAutoHeal: false,
  };
}

/**
 * Gate check for starting session: only allows starting when audio is saved.
 */
export function canStartSession({
  audioConfigStatus,
  actionPending = false,
  participantCount = 0,
}) {
  if (actionPending) return false;
  if (participantCount === 0) return false;
  if (audioConfigStatus !== 'saved') return false;
  return true;
}
