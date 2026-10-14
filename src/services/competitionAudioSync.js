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
 * Executes clean session isolation for audio states on session switch.
 * Guarantees that pending configs, generations, and errors of previous session
 * are strictly isolated and cannot leak into the new session.
 */
export function resetAudioStateForSessionSwitch({
  activeSessionIdRef,
  nextSessionId,
  latestAudioConfigRequestIdRef,
  pendingAudioConfigRef,
  lastSavedConfigRef,
  lastAudioConfigSavedAtRef,
}) {
  if (latestAudioConfigRequestIdRef) {
    latestAudioConfigRequestIdRef.current++;
  }
  if (pendingAudioConfigRef) {
    pendingAudioConfigRef.current = null;
  }
  if (lastSavedConfigRef) {
    lastSavedConfigRef.current = null;
  }
  if (lastAudioConfigSavedAtRef) {
    lastAudioConfigSavedAtRef.current = 0;
  }
  if (activeSessionIdRef) {
    activeSessionIdRef.current = nextSessionId;
  }

  return {
    nextStatus: 'idle',
    nextMode: 'in_class',
    nextError: null,
  };
}

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
 * - NEVER ignores real 401/403/500 query errors even when currentStatus is saved.
 * - NEVER allows stale in-flight polling snapshots to overwrite freshly saved online mode.
 */
export function classifyAudioSnapshotState({
  snapshot,
  activeSessionId,
  currentStatus,
  pendingAudioConfig = null,
  lastSavedConfig = null,
  lastSavedAt = 0,
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

  // Guard 1b: If pendingAudioConfig is bound to a different session, isolate it completely
  if (pendingAudioConfig && pendingAudioConfig._sessionId && pendingAudioConfig._sessionId !== activeSessionId) {
    pendingAudioConfig = null;
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

  // Freshness check: Determine if snapshot audio query was initiated BEFORE the last successful save.
  // Use _audio_fetched_at if available (when audio config was specifically queried), falling back to _fetched_at.
  const audioFetchedAt = typeof snapshot._audio_fetched_at === 'number'
    ? snapshot._audio_fetched_at
    : snapshot._fetched_at;

  const isSnapshotStale = Boolean(
    lastSavedAt > 0 &&
    typeof audioFetchedAt === 'number' &&
    audioFetchedAt < lastSavedAt
  );

  // Situation 2: Query failed (401/403/500/network)
  if (snapshot.audio_config_state === 'error' || Boolean(snapshot.audio_config_error)) {
    // If this error belongs to a stale in-flight request started BEFORE the save completed, drop it
    if (isSnapshotStale) {
      return {
        action: 'IGNORE_STALE_QUERY_ERROR',
        nextStatus: null,
        nextMode: null,
        nextError: null,
        shouldClearPending: false,
        shouldAutoHeal: false,
      };
    }
    // FRESH QUERY ERROR: MUST NEVER be ignored, even if currentStatus === 'saved'!
    // Surfacing real 401/403/500 errors avoids falsely confirming wrong configurations.
    return {
      action: 'QUERY_ERROR',
      nextStatus: 'failed',
      nextMode: null, // Preserve Host's current selection!
      nextError: snapshot.audio_config_error || 'Lỗi kết nối khi tải cấu hình âm thanh từ máy chủ.',
      shouldClearPending: false, // Keep pending for retry!
      shouldAutoHeal: false, // STRICTLY PROHIBITED
    };
  }

  // Guard 3: If Host already saved R19 configuration (or currentStatus === 'saved') and snapshot is unpersisted:
  if ((currentStatus === 'saved' || lastSavedConfig) && snapshot.audio_config_persisted === false) {
    // 3.1: If the unpersisted snapshot is actually stale (fetched before save completed), safely drop it
    if (isSnapshotStale) {
      return {
        action: 'IGNORE_STALE_UNPERSISTED_SNAPSHOT',
        nextStatus: null,
        nextMode: null,
        nextError: null,
        shouldClearPending: false,
        shouldAutoHeal: false,
      };
    }

    // 3.2: FRESH missing snapshot arriving AFTER save has completed:
    // The database does NOT have the saved record (e.g. save did not persist or row was removed).
    // MUST transition to 'failed' (NOT 'legacy_missing' because Host already saved R19).
    // STRICTLY preserve Host's chosen mode (e.g. online) and DO NOT auto-heal in_class!
    return {
      action: 'FRESH_MISSING_AFTER_SAVED',
      nextStatus: 'failed',
      nextMode: null, // PRESERVE Host's selected online mode!
      nextError: 'Cấu hình âm thanh chưa được ghi nhận trên máy chủ sau khi lưu.',
      shouldClearPending: false,
      shouldAutoHeal: false, // STRICTLY PROHIBITED to write default in_class!
    };
  }

  // Guard 4: Authoritative DB record exists
  if (snapshot.audio_config_persisted === true && isValidAudioConfig(snapshot.audio_config)) {
    // Subcase 4A: Host has a pending save or retry, verify DB matches Host's requested config!
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

    // Subcase 4B: RPC has already saved a config (e.g. Online saved), but a stale snapshot arrives
    // with an outdated config (e.g. in_class fetched before RPC finished)
    if (lastSavedConfig && !isAudioConfigMatching(snapshot.audio_config, lastSavedConfig)) {
      if (isSnapshotStale) {
        return {
          action: 'IGNORE_STALE_OUTDATED_CONFIG',
          nextStatus: null,
          nextMode: null,
          nextError: null,
          shouldClearPending: false,
          shouldAutoHeal: false,
        };
      }
      // Fresh snapshot after save, but DB config does not match what Host saved:
      return {
        action: 'SAVED_CONFIG_MISMATCH',
        nextStatus: 'failed',
        nextMode: null, // Never overwrite Host's mode!
        nextError: 'Cấu hình âm thanh trên máy chủ chưa khớp với cấu hình đã lưu.',
        shouldClearPending: false,
        shouldAutoHeal: false,
      };
    }

    // Subcase 4C: No pending save (e.g. F5 reload, restore, or idle): trust DB record
    return {
      action: 'RESTORE_FROM_DB',
      nextStatus: 'saved',
      nextMode: snapshot.audio_config?.mode || 'in_class',
      nextError: null,
      shouldClearPending: true,
      shouldAutoHeal: false,
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
