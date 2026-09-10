// scripts/test_exam_text_autosave_behavior.mjs
// Comprehensive Behavioral & Concurrency Verification for Text Autosave (Phase A)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function it(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [${String(totalTests).padStart(2, '0')}] PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`❌ [${String(totalTests).padStart(2, '0')}] FAIL: ${name}`);
    console.error(err);
  }
}

// Minimal In-Memory Mock of ExamTakingSession for runtime concurrency simulation
class MockExamTakingSession {
  constructor(options = {}) {
    this.attemptId = 'a0000000-0000-4000-8000-000000000001';
    this.version = 1;
    this.answersState = {};
    this.saveCalls = [];
    this.submitCalls = [];
    this.inFlightSaveCount = 0;
    this.maxConcurrentSaves = 0;
    this.saveDelayMs = options.saveDelayMs || 50;
    this.isFinalized = false;
  }

  getAttemptId() {
    return this.attemptId;
  }

  getAnswersState() {
    return { ...this.answersState };
  }

  async saveAnswer({ examQuestionId, studentAnswerJson }) {
    this.inFlightSaveCount++;
    if (this.inFlightSaveCount > this.maxConcurrentSaves) {
      this.maxConcurrentSaves = this.inFlightSaveCount;
    }

    const currentVersionAtDispatch = this.version;
    this.saveCalls.push({
      examQuestionId,
      studentAnswerJson,
      dispatchedVersion: currentVersionAtDispatch,
      timestamp: Date.now(),
    });

    if (this.saveDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.saveDelayMs));
    }

    // Version increments monotonically on successful save
    this.version++;
    this.answersState[examQuestionId] = {
      studentAnswerJson,
      gradingStatus: 'pending_auto',
      savedAt: new Date().toISOString(),
    };

    this.inFlightSaveCount--;
    return {
      ok: true,
      data: {
        attempt_id: this.attemptId,
        exam_question_id: examQuestionId,
        attempt_version: this.version,
        grading_status: 'pending_auto',
      },
    };
  }

  async submitAttempt() {
    this.submitCalls.push({
      versionAtSubmit: this.version,
      answersAtSubmit: { ...this.answersState },
      timestamp: Date.now(),
    });
    this.isFinalized = true;
    return {
      ok: true,
      data: {
        attempt_id: this.attemptId,
        status: 'submitted',
        attempt_version: this.version + 1,
      },
    };
  }
}

// Simulated Serialized Queue matching ExamTakingModal.jsx logic
function createTestQueue(session) {
  const latestTextDraftsRef = { current: {} };
  const queuedQuestionsToSaveRef = { current: new Set() };
  let isTextSaving = false;
  let inFlightSavePromise = null;
  let debounceTimer = null;

  async function flushPendingTextSave(targetQId = null) {
    if (targetQId) {
      queuedQuestionsToSaveRef.current.add(targetQId);
    }

    if (isTextSaving) {
      if (inFlightSavePromise) {
        try {
          await inFlightSavePromise;
        } catch (_) {}
      }
      return;
    }

    isTextSaving = true;
    let resolveInFlight;
    inFlightSavePromise = new Promise((resolve) => {
      resolveInFlight = resolve;
    });

    try {
      while (queuedQuestionsToSaveRef.current.size > 0) {
        const qId = queuedQuestionsToSaveRef.current.values().next().value;
        queuedQuestionsToSaveRef.current.delete(qId);

        const textValue =
          typeof latestTextDraftsRef.current[qId] === 'string'
            ? latestTextDraftsRef.current[qId]
            : '';

        const currentSaved = session.getAnswersState()[qId]?.studentAnswerJson;
        if (currentSaved === textValue) {
          continue;
        }

        const res = await session.saveAnswer({
          examQuestionId: qId,
          studentAnswerJson: textValue,
        });

        if (!res.ok) break;

        const newestText =
          typeof latestTextDraftsRef.current[qId] === 'string'
            ? latestTextDraftsRef.current[qId]
            : '';
        if (newestText !== textValue) {
          queuedQuestionsToSaveRef.current.add(qId);
        }
      }
    } finally {
      isTextSaving = false;
      if (resolveInFlight) {
        resolveInFlight();
      }
      inFlightSavePromise = null;
    }
  }

  function handleTextDraftChange(qId, text, debounceMs = 800) {
    latestTextDraftsRef.current[qId] = text;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushPendingTextSave(qId);
    }, debounceMs);
  }

  function handleBlur(qId) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    flushPendingTextSave(qId);
  }

  async function handleConfirmSubmit() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    for (const [qId, text] of Object.entries(latestTextDraftsRef.current)) {
      const savedVal = session.getAnswersState()[qId]?.studentAnswerJson;
      if (savedVal !== text) {
        queuedQuestionsToSaveRef.current.add(qId);
      }
    }

    await flushPendingTextSave();
    return await session.submitAttempt();
  }

  return {
    latestTextDraftsRef,
    queuedQuestionsToSaveRef,
    flushPendingTextSave,
    handleTextDraftChange,
    handleBlur,
    handleConfirmSubmit,
  };
}

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - TEXT AUTOSAVE BEHAVIORAL TESTS');
  console.log('====================================================\n');

  // Test A: type "5", wait > debounce -> session.saveAnswer called with "5"
  await it('Test A: Type "5" and wait > debounce -> saved with DB payload "5"', async () => {
    const session = new MockExamTakingSession();
    const queue = createTestQueue(session);
    const q1 = 'e0000004-0000-4000-8000-000000000004';

    queue.handleTextDraftChange(q1, '5', 50); // 50ms test debounce
    assert.strictEqual(session.saveCalls.length, 0, 'No save before debounce expires');

    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(session.saveCalls.length, 1, 'Exactly 1 save called after debounce');
    assert.strictEqual(session.saveCalls[0].studentAnswerJson, '5');
    assert.strictEqual(session.saveCalls[0].examQuestionId, q1);
    assert.strictEqual(session.getAnswersState()[q1].studentAnswerJson, '5');
  });

  // Test B: type "5" then change rapidly to "6" -> final persisted value = "6"
  await it('Test B: Rapid edit "5" -> "6" persists latest value "6"', async () => {
    const session = new MockExamTakingSession({ saveDelayMs: 60 });
    const queue = createTestQueue(session);
    const q1 = 'e0000004-0000-4000-8000-000000000004';

    // Trigger save for "5"
    queue.handleTextDraftChange(q1, '5', 10);
    await new Promise((r) => setTimeout(r, 25));

    // While save for "5" is in flight, user changes to "6"
    queue.handleTextDraftChange(q1, '6', 10);

    // Wait for all saves to complete
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(session.getAnswersState()[q1].studentAnswerJson, '6');
    assert.strictEqual(session.saveCalls[session.saveCalls.length - 1].studentAnswerJson, '6');
  });

  // Test C: rapid typing "12345" -> serialized saves, no attempt_version race
  await it('Test C: Rapid typing "12345" maintains MAX_CONCURRENT_SAVES = 1 and monotonic version', async () => {
    const session = new MockExamTakingSession({ saveDelayMs: 30 });
    const queue = createTestQueue(session);
    const q1 = 'e0000004-0000-4000-8000-000000000004';

    queue.handleTextDraftChange(q1, '1', 5);
    await new Promise((r) => setTimeout(r, 10));
    queue.handleTextDraftChange(q1, '12', 5);
    queue.handleTextDraftChange(q1, '123', 5);
    queue.handleTextDraftChange(q1, '1234', 5);
    queue.handleTextDraftChange(q1, '12345', 5);

    await new Promise((r) => setTimeout(r, 250));

    assert.strictEqual(session.maxConcurrentSaves, 1, 'At most 1 concurrent save allowed');
    assert.strictEqual(session.getAnswersState()[q1].studentAnswerJson, '12345');

    // Verify all dispatched versions were strictly strictly monotonic
    for (let i = 1; i < session.saveCalls.length; i++) {
      assert.ok(
        session.saveCalls[i].dispatchedVersion > session.saveCalls[i - 1].dispatchedVersion,
        'Versions must increment monotonically'
      );
    }
  });

  // Test D: type "5" and immediately submit -> pending answer flush completes BEFORE submitAttempt
  await it('Test D: Type "5" and immediately submit -> answer flushed before submitAttempt', async () => {
    const session = new MockExamTakingSession({ saveDelayMs: 40 });
    const queue = createTestQueue(session);
    const q1 = 'e0000004-0000-4000-8000-000000000004';

    // Type "5" with 800ms debounce
    queue.handleTextDraftChange(q1, '5', 800);

    // Immediately submit without waiting for debounce
    const submitRes = await queue.handleConfirmSubmit();

    assert.strictEqual(submitRes.ok, true);
    assert.strictEqual(session.saveCalls.length, 1, 'Save was flushed before submit');
    assert.strictEqual(session.saveCalls[0].studentAnswerJson, '5');
    assert.strictEqual(session.submitCalls.length, 1);
    assert.ok(
      session.saveCalls[0].timestamp <= session.submitCalls[0].timestamp,
      'Save timestamp must precede submit timestamp'
    );
    assert.strictEqual(session.submitCalls[0].answersAtSubmit[q1]?.studentAnswerJson, '5');
  });

  // Test E: type answer, blur -> pending value flushed through same queue
  await it('Test E: Type answer and blur -> immediately flushes through serialized queue', async () => {
    const session = new MockExamTakingSession();
    const queue = createTestQueue(session);
    const q1 = 'e0000004-0000-4000-8000-000000000004';

    queue.handleTextDraftChange(q1, 'Hello Blur', 800);
    queue.handleBlur(q1);

    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(session.saveCalls.length, 1);
    assert.strictEqual(session.saveCalls[0].studentAnswerJson, 'Hello Blur');
  });

  // Test F: manual "Lưu câu trả lời" uses same queue and creates no duplicate requests
  await it('Test F: Manual save button uses same queue without duplicate requests', async () => {
    const session = new MockExamTakingSession();
    const queue = createTestQueue(session);
    const q1 = 'e0000004-0000-4000-8000-000000000004';

    queue.handleTextDraftChange(q1, 'Manual Val', 800);
    await queue.flushPendingTextSave(q1);

    assert.strictEqual(session.saveCalls.length, 1);

    // Calling manual save again with unchanged value -> no extra save call
    await queue.flushPendingTextSave(q1);
    assert.strictEqual(session.saveCalls.length, 1, 'No duplicate save when value is unchanged');
  });

  // Test G: single_choice regression remains immediate save
  await it('Test G: single_choice save logic in ExamTakingModal.jsx remains immediate radio save', () => {
    const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamTakingModal.jsx');
    const modalSource = fs.readFileSync(modalPath, 'utf8');

    assert.ok(
      modalSource.includes('onChange={() => handleSaveSingleChoice(currentQuestion, opt.key)}'),
      'single_choice radio must trigger immediate handleSaveSingleChoice'
    );
    assert.ok(
      modalSource.includes('studentAnswerJson: optionKey,'),
      'single_choice must pass optionKey directly'
    );
  });

  // Test H: post-submit cleanup regression remains PASS
  await it('Test H: post-submit cleanup & white-screen hotfix remains intact', () => {
    const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamTakingModal.jsx');
    const modalSource = fs.readFileSync(modalPath, 'utf8');

    assert.ok(
      modalSource.includes('handleTeardown();'),
      'Teardown must be called on confirmed finalization'
    );
    assert.ok(
      modalSource.includes('if (onFinishedRef.current) onFinishedRef.current(finalizedData);'),
      'Must notify onFinished'
    );
    assert.ok(
      modalSource.includes('lifecycleEpochRef.current !== epoch'),
      'Epoch guards must remain active'
    );
  });

  console.log('\n====================================================');
  console.log(`TOTAL AUTOSAVE BEHAVIOR TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    throw new Error(`Autosave test suite failed with ${failedTests} failures.`);
  }
}

main().catch((err) => {
  console.error('❌ Test execution terminated with error:', err);
  process.exit(1);
});
