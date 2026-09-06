// src/services/examTakingSession.js
// Exam Builder V1 - Phase 3E Frontend Exam Taking Session Controller
// Pure JS Session Manager owning attempt state, authoritative ID resolution,
// version chain integrity, answer state, and finalization authority.
// Zero React dependency, Zero DOM, Zero direct Supabase import.

import {
  generateProvisionalAttemptId,
  isValidUuid,
} from './examStudentClient.js';

export const CONFIRMED_FINALIZED_STATUSES = Object.freeze([
  'submitted',
  'pending_manual_grade',
  'graded',
]);

export class ExamTakingSession {
  #assignmentId;
  #studentClient;
  #onConfirmedFinalized;
  #onStateChange;

  #provisionalAttemptId = null;
  #attemptId = null; // Authoritative ID returned by server
  #status = 'unstarted';
  #currentVersion = null; // Strictly integer >= 1 once started
  #startResult = null;
  #answersState = {}; // Record<exam_question_id, { studentAnswerJson, gradingStatus }>
  #submitResult = null;
  #isFinalized = false;
  #hasEmittedFinalized = false;

  /**
   * @param {Object} options
   * @param {string} options.assignmentId - Required assignment UUID
   * @param {Object} options.studentClient - Injected Student Client instance
   * @param {Function} [options.onConfirmedFinalized] - Callback fired EXACTLY ONCE when attempt is finalized
   * @param {Function} [options.onStateChange] - Callback fired when session state updates
   */
  constructor(options = {}) {
    const { assignmentId, studentClient, onConfirmedFinalized, onStateChange } = options;

    if (!isValidUuid(assignmentId)) {
      throw new Error('ExamTakingSession requires a valid assignmentId UUID string.');
    }
    if (!studentClient || typeof studentClient.startAttempt !== 'function') {
      throw new Error('ExamTakingSession requires a valid studentClient with startAttempt, saveAnswer, and submitAttempt.');
    }

    this.#assignmentId = assignmentId.trim().toLowerCase();
    this.#studentClient = studentClient;
    this.#onConfirmedFinalized = typeof onConfirmedFinalized === 'function' ? onConfirmedFinalized : null;
    this.#onStateChange = typeof onStateChange === 'function' ? onStateChange : null;

    // Generate provisional attempt ID once before start
    this.#provisionalAttemptId = generateProvisionalAttemptId();
  }

  getAssignmentId() {
    return this.#assignmentId;
  }

  getProvisionalAttemptId() {
    return this.#provisionalAttemptId;
  }

  getAttemptId() {
    return this.#attemptId;
  }

  getStatus() {
    return this.#status;
  }

  getCurrentVersion() {
    return this.#currentVersion;
  }

  getStartResult() {
    return this.#startResult ? { ...this.#startResult } : null;
  }

  getAnswersState() {
    return { ...this.#answersState };
  }

  getAnswer(examQuestionId) {
    if (!examQuestionId) return null;
    return this.#answersState[examQuestionId.trim().toLowerCase()] || null;
  }

  getSubmitResult() {
    return this.#submitResult ? { ...this.#submitResult } : null;
  }

  isFinalized() {
    return this.#isFinalized;
  }

  getState() {
    return {
      assignmentId: this.#assignmentId,
      provisionalAttemptId: this.#provisionalAttemptId,
      attemptId: this.#attemptId,
      status: this.#status,
      currentVersion: this.#currentVersion,
      isFinalized: this.#isFinalized,
      answersCount: Object.keys(this.#answersState).length,
      hasStartResult: Boolean(this.#startResult),
      hasSubmitResult: Boolean(this.#submitResult),
    };
  }

  #notifyStateChange() {
    if (this.#onStateChange) {
      try {
        this.#onStateChange(this.getState());
      } catch (_) {
        // Guard against subscriber errors
      }
    }
  }

  #checkAndEmitFinalized(resultData) {
    if (!resultData) return;

    const isStatusFinalized = CONFIRMED_FINALIZED_STATUSES.includes(resultData.status) || Boolean(resultData.already_finalized);
    if (isStatusFinalized) {
      this.#isFinalized = true;
      if (!this.#hasEmittedFinalized) {
        this.#hasEmittedFinalized = true;
        if (this.#onConfirmedFinalized) {
          try {
            this.#onConfirmedFinalized(resultData);
          } catch (_) {
            // Guard against subscriber errors
          }
        }
      }
    }
  }

  /**
   * Starts or resumes an exam taking attempt.
   * Reuses provisional UUID across replays of the same logical start.
   * Authoritative attempt ID and version are set from successful server response.
   */
  async start() {
    if (this.#isFinalized && this.#startResult) {
      return { ok: true, data: this.#startResult };
    }

    const res = await this.#studentClient.startAttempt({
      assignmentId: this.#assignmentId,
      attemptId: this.#attemptId || this.#provisionalAttemptId,
    });

    if (!res.ok) {
      return res;
    }

    const data = res.data;
    // Authoritative ID replaces provisional ID (handles resumed existing drafts)
    this.#attemptId = data.attempt_id;
    this.#currentVersion = data.attempt_version;
    this.#status = data.status;
    this.#startResult = data;

    this.#checkAndEmitFinalized(data);
    this.#notifyStateChange();

    return { ok: true, data };
  }

  /**
   * Saves student answer for a specific question.
   * Requires authoritative attempt ID and currentVersion >= 1.
   * currentVersion is updated ONLY upon successful server response.
   */
  async saveAnswer(params = {}) {
    const { examQuestionId, studentAnswerJson } = params;

    if (!this.#attemptId) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'ATTEMPT_NOT_STARTED',
      };
    }
    if (typeof this.#currentVersion !== 'number' || !Number.isInteger(this.#currentVersion) || this.#currentVersion < 1) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_VERSION_STATE',
      };
    }
    if (this.#isFinalized) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'ERR_ATTEMPT_ALREADY_FINALIZED',
      };
    }
    if (!isValidUuid(examQuestionId)) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_INPUT',
      };
    }

    const qId = examQuestionId.trim().toLowerCase();

    const res = await this.#studentClient.saveAnswer({
      attemptId: this.#attemptId,
      examQuestionId: qId,
      studentAnswerJson: studentAnswerJson !== undefined ? studentAnswerJson : null,
      fileUrl: null, // Strictly null in Phase 3E-A
      expectedVersion: this.#currentVersion,
    });

    if (!res.ok) {
      // Version and prior answer state remain strictly unchanged on failure
      return res;
    }

    const data = res.data;
    this.#currentVersion = data.attempt_version;
    this.#answersState[qId] = {
      studentAnswerJson: studentAnswerJson !== undefined ? studentAnswerJson : null,
      gradingStatus: data.grading_status,
      savedAt: new Date().toISOString(),
    };

    this.#notifyStateChange();
    return { ok: true, data };
  }

  /**
   * Submits the exam attempt for finalization and grading.
   * Sends expected_version = currentVersion.
   * Updates currentVersion from server response.version.
   * Emits onConfirmedFinalized ONCE when status reaches confirmed finalized.
   */
  async submitAttempt() {
    if (!this.#attemptId) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'ATTEMPT_NOT_STARTED',
      };
    }
    if (typeof this.#currentVersion !== 'number' || !Number.isInteger(this.#currentVersion) || this.#currentVersion < 1) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_VERSION_STATE',
      };
    }
    if (this.#isFinalized && this.#submitResult) {
      return { ok: true, data: this.#submitResult };
    }

    const res = await this.#studentClient.submitAttempt({
      attemptId: this.#attemptId,
      expectedVersion: this.#currentVersion,
    });

    if (!res.ok) {
      return res;
    }

    const data = res.data;
    this.#currentVersion = data.version; // Updated from submit response.version
    this.#status = data.status;
    this.#submitResult = data;

    this.#checkAndEmitFinalized(data);
    this.#notifyStateChange();

    return { ok: true, data };
  }
}

export function createExamTakingSession(options = {}) {
  return new ExamTakingSession(options);
}
