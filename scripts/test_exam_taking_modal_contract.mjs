// scripts/test_exam_taking_modal_contract.mjs
// Exam Builder V1 - Phase 3E-B Step 2: ExamTakingModal Contract & Behavioral Static Verification Tests
// Real contract assertions covering session stability, async unmount guards, lifecycle epochs, answer payload shapes,
// multiple choice server ordering, advisory countdown safety, and integrity ownership.

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

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 3E-B MODAL CONTRACT TESTS');
  console.log('====================================================\n');

  const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamTakingModal.jsx');
  const modalExists = fs.existsSync(modalPath);
  const modalSource = modalExists ? fs.readFileSync(modalPath, 'utf8').replace(/\r\n/g, '\n') : '';

  // 1. Structure & Imports
  await it('01 ExamTakingModal.jsx file exists at expected path', () => {
    assert.strictEqual(modalExists, true, 'ExamTakingModal.jsx must exist at src/components/dashboard/exams/ExamTakingModal.jsx');
  });

  await it('02 ExamTakingModal imports createExamTakingSession from examTakingSession.js', () => {
    assert.ok(
      modalSource.includes("from '../../../services/examTakingSession.js'") ||
      modalSource.includes("from '../../../services/examTakingSession'"),
      'Must import from examTakingSession'
    );
    assert.ok(modalSource.includes('createExamTakingSession'), 'Must use createExamTakingSession');
  });

  await it('03 ExamTakingModal imports useExamIntegrity from useExamIntegrity.js', () => {
    assert.ok(
      modalSource.includes("from '../../../hooks/useExamIntegrity.js'") ||
      modalSource.includes("from '../../../hooks/useExamIntegrity'"),
      'Must import from useExamIntegrity'
    );
    assert.ok(modalSource.includes('useExamIntegrity'), 'Must use useExamIntegrity');
  });

  await it('04 Legacy ExercisePlayModal is untouched', () => {
    const legacyPath = path.resolve(__dirname, '../src/components/dashboard/exercises/ExercisePlayModal.jsx');
    if (fs.existsSync(legacyPath)) {
      const legacySource = fs.readFileSync(legacyPath, 'utf8');
      assert.strictEqual(legacySource.includes('ExamTakingSession'), false, 'ExercisePlayModal must remain untouched');
    }
  });

  // 2. Lifecycle & Integrity Enablement Gate
  await it('05 Strict Lifecycle Flow: start -> loadQuestions -> start integrity in exact order', () => {
    const startIdx = modalSource.indexOf('session.start()');
    const loadIdx = modalSource.indexOf('session.loadQuestions()');
    const integrityCheck = modalSource.indexOf('questionsLoaded &&');

    assert.ok(startIdx > -1, 'Must invoke session.start()');
    assert.ok(loadIdx > -1, 'Must invoke session.loadQuestions()');
    assert.ok(startIdx < loadIdx, 'start() must be invoked before loadQuestions()');
    assert.ok(integrityCheck > -1, 'Integrity enabled must require questionsLoaded to avoid race condition');
  });

  await it('06 Integrity Enablement Gate asserts complete condition formula', () => {
    assert.ok(
      modalSource.includes('isOpen &&') &&
      modalSource.includes('questionsLoaded &&') &&
      modalSource.includes('attemptId &&') &&
      modalSource.includes('!isFinalized'),
      'Must gate integrity enablement on isOpen, questionsLoaded, attemptId, !isFinalized'
    );
  });

  // 3. Session Stability & Ref Ownership
  await it('07 Session lifecycle effect does NOT depend on onFinished callback identity', () => {
    const effectMatch = modalSource.match(/initSession\(\);\s*return \(\) => {[\s\S]*?};\s*}\s*,\s*\[(.*?)\]\);/);
    assert.ok(effectMatch, 'Must find session lifecycle useEffect dependency array');
    const deps = effectMatch[1];
    assert.strictEqual(deps.includes('onFinished'), false, 'onFinished must NOT be in session lifecycle dependency array');
    assert.strictEqual(deps.includes('onClose'), false, 'onClose must NOT be in session lifecycle dependency array');
    assert.ok(deps.includes('isOpen'), 'Must include isOpen');
    assert.ok(deps.includes('assignmentId'), 'Must include assignmentId');
  });

  await it('08 Callback refs (onFinishedRef, onCloseRef) are used for stable event dispatch', () => {
    assert.ok(modalSource.includes('const onFinishedRef = useRef(onFinished);'), 'Must declare onFinishedRef');
    assert.ok(modalSource.includes('onFinishedRef.current = onFinished;'), 'Must sync onFinishedRef in useEffect');
    assert.ok(modalSource.includes('if (onFinishedRef.current) onFinishedRef.current(finalizedData);'), 'Must call onFinishedRef.current on finalization');
    assert.ok(modalSource.includes('const onCloseRef = useRef(onClose);'), 'Must declare onCloseRef');
    assert.ok(modalSource.includes('onCloseRef.current = onClose;'), 'Must sync onCloseRef in useEffect');
    assert.ok(modalSource.includes('if (onCloseRef.current) onCloseRef.current();'), 'Must call onCloseRef.current on close');
  });

  await it('09 Stale cleanup cannot clear newer session instance', () => {
    assert.ok(
      modalSource.includes('if (sessionRef.current === session) {\n        sessionRef.current = null;\n      }'),
      'Cleanup must only clear sessionRef.current if it matches current effect session instance'
    );
  });

  // 4. Async Mount & Unmount Guards
  await it('10 Start result has async unmount / subscription guard', () => {
    const startSection = modalSource.substring(
      modalSource.indexOf('const startRes = await session.start();'),
      modalSource.indexOf('const qRes = await session.loadQuestions();')
    );
    assert.ok(startSection.includes('if (!isSubscribed'), 'Must guard after session.start()');
  });

  await it('11 Load questions result has async unmount / subscription guard', () => {
    const loadSection = modalSource.substring(
      modalSource.indexOf('const qRes = await session.loadQuestions();'),
      modalSource.indexOf('const loadedQuestions =')
    );
    assert.ok(loadSection.includes('if (!isSubscribed'), 'Must guard after session.loadQuestions()');
  });

  await it('12 Save async completion has mounted UI guard (isMountedRef)', () => {
    assert.ok(modalSource.includes('const isMountedRef = useRef(true);'), 'Must declare isMountedRef');
    const singleSaveSection = modalSource.substring(
      modalSource.indexOf('const handleSaveSingleChoice'),
      modalSource.indexOf('const handleToggleMultipleChoiceOption')
    );
    assert.ok(singleSaveSection.includes('!isMountedRef.current'), 'handleSaveSingleChoice must check isMountedRef after await');

    const multiSaveSection = modalSource.substring(
      modalSource.indexOf('const handleSaveMultipleChoice'),
      modalSource.indexOf('const handleTextDraftChange')
    );
    assert.ok(multiSaveSection.includes('!isMountedRef.current'), 'handleSaveMultipleChoice must check isMountedRef after await');

    const textSaveSection = modalSource.substring(
      modalSource.indexOf('const handleSaveTextAnswer'),
      modalSource.indexOf('const handleOpenSubmitDialog')
    );
    assert.ok(textSaveSection.includes('!isMountedRef.current'), 'handleSaveTextAnswer must check isMountedRef after await');
  });

  await it('13 Submit async completion has mounted UI guard (isMountedRef)', () => {
    const submitSection = modalSource.substring(
      modalSource.indexOf('const handleConfirmSubmit'),
      modalSource.indexOf('const handleModalClose')
    );
    assert.ok(submitSection.includes('!isMountedRef.current'), 'handleConfirmSubmit must check isMountedRef after await');
  });

  // 5. Answer Payload Shapes & Server Ordering
  await it('14 single_choice passes optionKey string to studentAnswerJson', () => {
    assert.ok(
      modalSource.includes('studentAnswerJson: optionKey,'),
      'single_choice saveAnswer must pass studentAnswerJson: optionKey'
    );
  });

  await it('15 multiple_choice passes orderedKeys array to studentAnswerJson', () => {
    assert.ok(
      modalSource.includes('studentAnswerJson: orderedKeys,'),
      'multiple_choice saveAnswer must pass studentAnswerJson: orderedKeys'
    );
  });

  await it('16 multiple_choice orders keys strictly according to server question.options', () => {
    assert.ok(
      modalSource.includes('const serverOptionKeys = (question.options || []).map((o) => o.key);'),
      'Must extract serverOptionKeys from question.options'
    );
    assert.ok(
      modalSource.includes('const orderedKeys = serverOptionKeys.filter((k) => draftList.includes(k));'),
      'Must filter serverOptionKeys to produce orderedKeys'
    );
    assert.strictEqual(modalSource.includes('.sort('), false, 'Must not locally sort keys or questions');
    assert.strictEqual(modalSource.includes('Math.random()'), false, 'Must not shuffle');
  });

  await it('17 text-based questions pass textValue string to studentAnswerJson', () => {
    assert.ok(
      modalSource.includes('studentAnswerJson: textValue,'),
      'text answers must pass studentAnswerJson: textValue'
    );
  });

  // 6. Navigation
  await it('18 Navigation handlers (Previous, Next, Question Pills) strictly do NOT save answers', () => {
    const prevFunc = modalSource.substring(
      modalSource.indexOf('const handlePrevious'),
      modalSource.indexOf('const handleNext')
    );
    assert.strictEqual(prevFunc.includes('saveAnswer'), false, 'handlePrevious must not save answers');

    const nextFunc = modalSource.substring(
      modalSource.indexOf('const handleNext'),
      modalSource.indexOf('const handleJumpToQuestion')
    );
    assert.strictEqual(nextFunc.includes('saveAnswer'), false, 'handleNext must not save answers');

    const jumpFunc = modalSource.substring(
      modalSource.indexOf('const handleJumpToQuestion'),
      modalSource.indexOf('const handleSaveSingleChoice')
    );
    assert.strictEqual(jumpFunc.includes('saveAnswer'), false, 'handleJumpToQuestion must not save answers');
  });

  // 7. Advisory Countdown & Zero Hard Lock
  await it('19 Advisory countdown timer exists and reads expires_at', () => {
    assert.ok(modalSource.includes('expires_at'), 'Must read expires_at from server start result');
    assert.ok(modalSource.includes('remainingSeconds'), 'Must calculate remaining seconds');
    assert.ok(modalSource.includes('isAdvisoryExpired'), 'Must have isAdvisoryExpired state');
  });

  await it('20 Advisory countdown does NOT auto-submit, finalize, or stop integrity on zero', () => {
    const timerEffect = modalSource.substring(
      modalSource.indexOf('// 2. Advisory Countdown Timer'),
      modalSource.indexOf('// Format advisory countdown')
    );
    assert.strictEqual(timerEffect.includes('submitAttempt'), false, 'Countdown zero must not call submitAttempt');
    assert.strictEqual(timerEffect.includes("setPhase('submitted')"), false, 'Countdown zero must not set submitted phase');
    assert.strictEqual(timerEffect.includes('stopIntegrity'), false, 'Countdown zero must not stop integrity');
    assert.strictEqual(timerEffect.includes('handleTeardown'), false, 'Countdown zero must not teardown integrity');
  });

  await it('21 Answer input controls are NOT disabled solely from advisory timer expiration', () => {
    const answerControls = modalSource.substring(
      modalSource.indexOf('{/* Question Answer Controls by Type */}'),
      modalSource.indexOf('{/* Save Error Notice */}')
    );
    assert.strictEqual(answerControls.includes('disabled={isAdvisoryExpired'), false, 'Inputs must not be disabled by isAdvisoryExpired');
    assert.strictEqual(answerControls.includes('disabled={remainingSeconds'), false, 'Inputs must not be disabled by remainingSeconds');
  });

  // 8. Upload Disability
  await it('22 image_upload and file_upload are strictly disabled with clear advisory notice', () => {
    assert.ok(modalSource.includes("currentQuestion.question_type === 'image_upload'"), 'Must handle image_upload');
    assert.ok(modalSource.includes("currentQuestion.question_type === 'file_upload'"), 'Must handle file_upload');
    assert.ok(modalSource.includes('Tính năng nộp hình ảnh đang tạm thời được tắt'), 'Must show image notice');
    assert.ok(modalSource.includes('Tính năng nộp tệp đính kèm đang tạm thời được tắt'), 'Must show file notice');
  });

  // 9. Submit & Stop Integrity Ownership
  await it('23 Submit confirmation dialog exists with summary statistics (answered/unanswered/total)', () => {
    assert.ok(modalSource.includes('showSubmitConfirm'), 'Must have showSubmitConfirm state');
    assert.ok(modalSource.includes('Xác nhận nộp bài'), 'Must render confirmation dialog');
    assert.ok(modalSource.includes('totalQuestions'), 'Must show total questions');
    assert.ok(modalSource.includes('answeredCount'), 'Must show answered count');
    assert.ok(modalSource.includes('unansweredCount'), 'Must show unanswered count');
  });

  await it('24 Submit failure does NOT stop integrity and keeps session active', () => {
    const submitFunc = modalSource.substring(
      modalSource.indexOf('const handleConfirmSubmit'),
      modalSource.indexOf('const handleModalClose')
    );
    assert.ok(submitFunc.includes('submitAttempt()'), 'Must call submitAttempt()');
    const failSection = submitFunc.substring(submitFunc.indexOf('if (!res.ok)'));
    assert.strictEqual(failSection.includes('stopIntegrity'), false, 'Submit failure must not stop integrity');
    assert.strictEqual(failSection.includes('handleTeardown'), false, 'Submit failure must not teardown integrity');
  });

  await it('25 Confirmed finalization callback owns stopIntegrity and transitions to submitted phase', () => {
    assert.ok(modalSource.includes('onConfirmedFinalized:'), 'Session must register onConfirmedFinalized');
    assert.ok(modalSource.includes("setPhase('submitted')"), 'Must transition to submitted phase');
    assert.ok(modalSource.includes('handleTeardown()'), 'Must teardown integrity on finalization');
  });

  await it('26 Closing modal does NOT auto-submit or locally finalize draft attempt', () => {
    const closeFunc = modalSource.substring(
      modalSource.indexOf('const handleModalClose'),
      modalSource.indexOf('if (!isOpen)')
    );
    assert.strictEqual(closeFunc.includes('submitAttempt'), false, 'Closing modal must not submit attempt');
    assert.strictEqual(closeFunc.includes("setPhase('submitted')"), false, 'Closing modal must not mark attempt submitted');
  });

  // 10. Zero Persistent Storage & Zero Debounce / Retry Queue
  await it('27 Zero debounce and zero retry queue in ExamTakingModal', () => {
    assert.strictEqual(modalSource.includes('debounce'), false, 'Must not use debounce autosave');
    assert.strictEqual(modalSource.includes('setTimeout'), false, 'Must not use setTimeout for save debounce');
    assert.strictEqual(modalSource.includes('retryQueue'), false, 'Must not build retry queue');
  });

  await it('28 Zero localStorage, sessionStorage, or IndexedDB references in ExamTakingModal', () => {
    assert.strictEqual(modalSource.includes('localStorage'), false, 'Must not reference localStorage');
    assert.strictEqual(modalSource.includes('sessionStorage'), false, 'Must not reference sessionStorage');
    assert.strictEqual(modalSource.includes('indexedDB'), false, 'Must not reference indexedDB');
    assert.strictEqual(modalSource.includes('openDatabase'), false, 'Must not reference WebSQL');
  });

  // 11. Lifecycle Generation Epoch & Stale UI Guards
  await it('29 Lifecycle epoch / generation ref exists in modal', () => {
    assert.ok(modalSource.includes('const lifecycleEpochRef = useRef(0);'), 'Must declare lifecycleEpochRef with initial 0');
  });

  await it('30 Modal close and unmount/replacement invalidate epoch generation', () => {
    const closeSection = modalSource.substring(
      modalSource.indexOf('const handleModalClose = useCallback'),
      modalSource.indexOf('if (!isOpen) return null;')
    );
    assert.ok(closeSection.includes('lifecycleEpochRef.current++;'), 'handleModalClose must increment lifecycleEpochRef');

    const cleanupSection = modalSource.substring(
      modalSource.indexOf('return () => {'),
      modalSource.indexOf('}, [isOpen, assignmentId, studentClient, handleTeardown]);')
    );
    assert.ok(cleanupSection.includes('lifecycleEpochRef.current++;'), 'useEffect cleanup must increment lifecycleEpochRef');
  });

  await it('31 Start completion verifies both epoch and session identity', () => {
    const startSection = modalSource.substring(
      modalSource.indexOf('const startRes = await session.start();'),
      modalSource.indexOf('if (!startRes.ok) {')
    );
    assert.ok(
      startSection.includes('lifecycleEpochRef.current !== epoch') &&
      startSection.includes('sessionRef.current !== session'),
      'start completion must verify epoch and session identity before state update'
    );
  });

  await it('32 Load questions completion verifies both epoch and session identity', () => {
    const loadSection = modalSource.substring(
      modalSource.indexOf('const qRes = await session.loadQuestions();'),
      modalSource.indexOf('if (!qRes.ok) {')
    );
    assert.ok(
      loadSection.includes('lifecycleEpochRef.current !== epoch') &&
      loadSection.includes('sessionRef.current !== session'),
      'loadQuestions completion must verify epoch and session identity before state update'
    );
  });

  await it('33 Single choice save captures session and epoch, verifying both after await', () => {
    const singleSection = modalSource.substring(
      modalSource.indexOf('const handleSaveSingleChoice = useCallback('),
      modalSource.indexOf('const handleToggleMultipleChoiceOption = useCallback(')
    );
    assert.ok(singleSection.includes('const session = sessionRef.current;'), 'Must capture session at dispatch time');
    assert.ok(singleSection.includes('const epoch = lifecycleEpochRef.current;'), 'Must capture epoch at dispatch time');
    assert.ok(
      singleSection.includes('lifecycleEpochRef.current !== epoch') &&
      singleSection.includes('sessionRef.current !== session'),
      'Must verify epoch and session identity after saveAnswer await'
    );
  });

  await it('34 Multiple choice save captures session and epoch, verifying both after await', () => {
    const multiSection = modalSource.substring(
      modalSource.indexOf('const handleSaveMultipleChoice = useCallback('),
      modalSource.indexOf('const handleTextDraftChange = useCallback(')
    );
    assert.ok(multiSection.includes('const session = sessionRef.current;'), 'Must capture session at dispatch time');
    assert.ok(multiSection.includes('const epoch = lifecycleEpochRef.current;'), 'Must capture epoch at dispatch time');
    assert.ok(
      multiSection.includes('lifecycleEpochRef.current !== epoch') &&
      multiSection.includes('sessionRef.current !== session'),
      'Must verify epoch and session identity after saveAnswer await'
    );
  });

  await it('35 Text answer save captures session and epoch, verifying both after await', () => {
    const textSection = modalSource.substring(
      modalSource.indexOf('const handleSaveTextAnswer = useCallback('),
      modalSource.indexOf('const handleOpenSubmitDialog = useCallback(')
    );
    assert.ok(textSection.includes('const session = sessionRef.current;'), 'Must capture session at dispatch time');
    assert.ok(textSection.includes('const epoch = lifecycleEpochRef.current;'), 'Must capture epoch at dispatch time');
    assert.ok(
      textSection.includes('lifecycleEpochRef.current !== epoch') &&
      textSection.includes('sessionRef.current !== session'),
      'Must verify epoch and session identity after saveAnswer await'
    );
  });

  await it('36 Submit captures session and epoch, verifying both after await', () => {
    const submitSection = modalSource.substring(
      modalSource.indexOf('const handleConfirmSubmit = useCallback(async () => {'),
      modalSource.indexOf('const handleModalClose = useCallback(')
    );
    assert.ok(submitSection.includes('const session = sessionRef.current;'), 'Must capture session at dispatch time');
    assert.ok(submitSection.includes('const epoch = lifecycleEpochRef.current;'), 'Must capture epoch at dispatch time');
    assert.ok(
      submitSection.includes('lifecycleEpochRef.current !== epoch') &&
      submitSection.includes('sessionRef.current !== session'),
      'Must verify epoch and session identity after submitAttempt await'
    );
  });

  await it('37 Stale async response cannot mutate reopened modal lifecycle', () => {
    // Assert onConfirmedFinalized and onStateChange also check epoch and session
    const callbackSection = modalSource.substring(
      modalSource.indexOf('createExamTakingSession({'),
      modalSource.indexOf('sessionRef.current = session;')
    );
    assert.ok(
      callbackSection.includes('lifecycleEpochRef.current !== epoch') &&
      callbackSection.includes('sessionRef.current !== session'),
      'Callbacks must guard against stale epoch or session mutations'
    );
  });

  console.log('\n====================================================');
  console.log(`TOTAL MODAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    throw new Error(`Modal test suite failed with ${failedTests} failures.`);
  }
}

main().catch((err) => {
  console.error('❌ Test execution terminated with error:', err);
  process.exit(1);
});
