/**
 * SCORM RESUME LIFECYCLE DIRECT UNIT TEST SUITE
 * Kiểm tra độc lập các kịch bản A, B, C, D theo đúng tiêu chuẩn ADL SCORM
 */

import assert from 'node:assert/strict';
import { createScorm12Api, createScorm2004Api } from '../scorm-player/src/scormApi.js';

console.log('====================================================');
console.log('🧪 TEST A: SCORM 2004 SESSION 1 (Fresh Launch)');
console.log('====================================================');
{
  const api = createScorm2004Api({
    studentId: 'STUDENT_A',
    studentName: 'Học sinh A',
    tracking: {}
  });

  assert.equal(api.Initialize(), 'true');
  assert.equal(api.GetValue('cmi.entry'), 'ab-initio', 'Session 1: cmi.entry must be ab-initio');
  assert.equal(api.GetValue('cmi.exit'), '', 'Session 1: cmi.exit must be empty');
  assert.equal(api.GetValue('cmi.session_time'), 'PT0H0M0S', 'Session 1: cmi.session_time must be PT0H0M0S');
  assert.equal(api.GetValue('cmi.location'), '', 'Session 1: location must be empty');
  assert.equal(api.GetValue('cmi.suspend_data'), '', 'Session 1: suspend_data must be empty');
  console.log('✅ TEST A PASSED: SCORM 2004 Session 1 khởi tạo chính xác ab-initio');
}

console.log('\n====================================================');
console.log('🧪 TEST B: SCORM 2004 SESSION 2 (Resume Lifecycle Rehydration)');
console.log('====================================================');
{
  const staleCmi2004 = {
    'cmi.entry': 'ab-initio', // Cũ từ session 1
    'cmi.exit': 'suspend',    // Cũ từ session 1
    'cmi.session_time': 'PT0H45M12S', // Cũ từ session 1
    'cmi.location': 'unit_3_slide_4',
    'cmi.suspend_data': 'step=4|state={"viewed":[1,2,3,4]}',
    'cmi.score.raw': '92.5',
    'cmi.score.min': '0',
    'cmi.score.max': '100',
    'cmi.completion_status': 'incomplete',
    'cmi.success_status': 'passed',
    'cmi.interactions.0.id': 'q1',
    'cmi.interactions.0.result': 'correct'
  };

  const api = createScorm2004Api({
    studentId: 'STUDENT_A',
    studentName: 'Học sinh A',
    tracking: {
      location: 'unit_3_slide_4',
      suspend_data: 'step=4|state={"viewed":[1,2,3,4]}',
      score_raw: 92.5,
      score_min: 0,
      score_max: 100,
      completion_status: 'incomplete',
      success_status: 'passed',
      cmi_data: staleCmi2004
    }
  });

  assert.equal(api.Initialize(), 'true');
  // Lifecycle fields reset for new session
  assert.equal(api.GetValue('cmi.entry'), 'resume', 'cmi.entry must be resume');
  assert.equal(api.GetValue('cmi.exit'), '', 'cmi.exit must be reset to empty for new session');
  assert.equal(api.GetValue('cmi.session_time'), 'PT0H0M0S', 'cmi.session_time must be reset to PT0H0M0S for new session');

  // Educational progress fields preserved
  assert.equal(api.GetValue('cmi.suspend_data'), 'step=4|state={"viewed":[1,2,3,4]}', 'suspend_data must be preserved');
  assert.equal(api.GetValue('cmi.location'), 'unit_3_slide_4', 'location must be preserved');
  assert.equal(api.GetValue('cmi.score.raw'), '92.5', 'score.raw must be preserved');
  assert.equal(api.GetValue('cmi.score.min'), '0', 'score.min must be preserved');
  assert.equal(api.GetValue('cmi.score.max'), '100', 'score.max must be preserved');
  assert.equal(api.GetValue('cmi.completion_status'), 'incomplete', 'completion_status must be preserved');
  assert.equal(api.GetValue('cmi.success_status'), 'passed', 'success_status must be preserved');
  assert.equal(api.GetValue('cmi.interactions.0.id'), 'q1', 'interactions must be preserved');
  assert.equal(api.GetValue('cmi.interactions.0.result'), 'correct', 'interactions result must be preserved');

  console.log('✅ TEST B PASSED: SCORM 2004 Session 2 nạp lại dữ liệu học tập và tái thiết lập lifecycle chuẩn');
}

console.log('\n====================================================');
console.log('🧪 TEST C: SCORM 1.2 SESSION 1 & SESSION 2');
console.log('====================================================');
{
  // C1: Session 1 (Fresh)
  const api1 = createScorm12Api({
    studentId: 'STUDENT_B',
    studentName: 'Học sinh B',
    tracking: {}
  });
  assert.equal(api1.LMSInitialize(), 'true');
  assert.equal(api1.LMSGetValue('cmi.core.entry'), 'ab-initio');
  assert.equal(api1.LMSGetValue('cmi.core.exit'), '');
  assert.equal(api1.LMSGetValue('cmi.core.session_time'), '00:00:00');
  assert.equal(api1.LMSGetValue('cmi.core.lesson_location'), '');
  assert.equal(api1.LMSGetValue('cmi.suspend_data'), '');

  // C2: Session 2 (Resume)
  const staleCmi12 = {
    'cmi.core.entry': 'ab-initio',
    'cmi.core.exit': 'suspend',
    'cmi.core.session_time': '0000:28:45',
    'cmi.core.lesson_location': 'slide_9',
    'cmi.suspend_data': 'choice=C|stage=2',
    'cmi.core.score.raw': '88',
    'cmi.core.score.min': '0',
    'cmi.core.score.max': '100',
    'cmi.core.lesson_status': 'incomplete'
  };

  const api2 = createScorm12Api({
    studentId: 'STUDENT_B',
    studentName: 'Học sinh B',
    tracking: {
      lesson_location: 'slide_9',
      suspend_data: 'choice=C|stage=2',
      score_raw: 88,
      lesson_status: 'incomplete',
      cmi_data: staleCmi12
    }
  });

  assert.equal(api2.LMSInitialize(), 'true');
  // Lifecycle fields reset for new session
  assert.equal(api2.LMSGetValue('cmi.core.entry'), 'resume', 'cmi.core.entry must be resume');
  assert.equal(api2.LMSGetValue('cmi.core.exit'), '', 'cmi.core.exit must be reset to empty for new session');
  assert.equal(api2.LMSGetValue('cmi.core.session_time'), '00:00:00', 'cmi.core.session_time must be reset to 00:00:00 for new session');

  // Educational progress fields preserved
  assert.equal(api2.LMSGetValue('cmi.suspend_data'), 'choice=C|stage=2', 'suspend_data must be preserved');
  assert.equal(api2.LMSGetValue('cmi.core.lesson_location'), 'slide_9', 'lesson_location must be preserved');
  assert.equal(api2.LMSGetValue('cmi.core.score.raw'), '88', 'score.raw must be preserved');
  assert.equal(api2.LMSGetValue('cmi.core.lesson_status'), 'incomplete', 'lesson_status must be preserved');

  console.log('✅ TEST C PASSED: SCORM 1.2 Session 1 & 2 hoạt động chính xác theo tiêu chuẩn');
}

console.log('\n====================================================');
console.log('🧪 TEST D: REGRESSION & API RUNTIME CONTRACT');
console.log('====================================================');
{
  // D1: SCORM 1.2 Commit & Finish callback
  let commitCount12 = 0;
  let finishCount12 = 0;
  const api12 = createScorm12Api({}, (cmi, event) => {
    if (event === 'COMMIT') commitCount12++;
    if (event === 'FINISH') finishCount12++;
  });
  assert.equal(api12.LMSInitialize(), 'true');
  assert.equal(api12.LMSSetValue('cmi.core.lesson_location', 'page_10'), 'true');
  assert.equal(api12.LMSCommit(), 'true');
  assert.equal(commitCount12, 1);
  assert.equal(api12.LMSFinish(), 'true');
  assert.equal(finishCount12, 1);

  // D2: SCORM 2004 Commit & Terminate callback
  let commitCount2004 = 0;
  let termCount2004 = 0;
  const api2004 = createScorm2004Api({}, (cmi, event) => {
    if (event === 'COMMIT') commitCount2004++;
    if (event === 'TERMINATE') termCount2004++;
  });
  assert.equal(api2004.Initialize(), 'true');
  assert.equal(api2004.SetValue('cmi.location', 'page_10'), 'true');
  assert.equal(api2004.Commit(), 'true');
  assert.equal(commitCount2004, 1);
  assert.equal(api2004.Terminate(), 'true');
  assert.equal(termCount2004, 1);

  console.log('✅ TEST D PASSED: Callback, Commit, Terminate, Get/Set CMI hoạt động nguyên vẹn');
}

console.log('\n====================================================');
console.log('🎉 ALL SCORM RESUME LIFECYCLE TESTS PASSED 100%!');
console.log('====================================================');
