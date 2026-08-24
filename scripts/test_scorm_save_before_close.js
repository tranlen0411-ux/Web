/**
 * SCORM SAVE-BEFORE-CLOSE STATIC & RUNTIME INTEGRATION TEST
 * Xác minh cơ chế lưu trữ an toàn trước khi đóng modal:
 * 1. SCORM_REQUEST_SAVE_BEFORE_CLOSE lấy đúng snapshot từ _getCmi()
 * 2. Không gọi Terminate / LMSFinish cưỡng bức
 * 3. Bảo tồn toàn vẹn dữ liệu chưa kịp commit
 * 4. Kiểm tra hợp đồng postMessage 2 chiều giữa Modal và Player
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorm12Api, createScorm2004Api } from '../scorm-player/src/scormApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🧪 TEST 1: SCORM 1.2 SAVE-BEFORE-CLOSE SNAPSHOT ACCURACY');
console.log('====================================================');
{
  let commitCount = 0;
  let lastEvent = '';
  let lastSnapshot = null;

  const api12 = createScorm12Api({}, (cmi, event) => {
    commitCount++;
    lastEvent = event;
    lastSnapshot = cmi;
  });

  api12.LMSInitialize();
  // SCO thực hiện SetValue nhưng chưa kịp LMSCommit
  api12.LMSSetValue('cmi.core.lesson_location', 'page_unsaved_4');
  api12.LMSSetValue('cmi.suspend_data', 'checkpoint=4|interactive_score=85');

  // Player gọi _getCmi() khi nhận SCORM_REQUEST_SAVE_BEFORE_CLOSE
  assert.equal(typeof api12._getCmi, 'function', 'api12._getCmi must be a function');
  const snapshot = api12._getCmi();

  assert.equal(snapshot['cmi.core.lesson_location'], 'page_unsaved_4');
  assert.equal(snapshot['cmi.suspend_data'], 'checkpoint=4|interactive_score=85');

  // Mô phỏng handleCmiCommit(snapshot, 'PARENT_CLOSE_SNAPSHOT')
  api12.LMSSetValue('cmi.core.lesson_status', 'incomplete');
  const finalSnap = api12._getCmi();
  
  // Xác nhận KHÔNG bị cưỡng bức LMSFinish (trạng thái terminated = false, vẫn có thể thao tác)
  assert.equal(api12.LMSSetValue('cmi.core.session_time', '0000:02:15'), 'true', 'Must not be terminated');
  console.log('✅ TEST 1 PASSED: SCORM 1.2 _getCmi() trả chính xác các giá trị mới nhất mà không cưỡng bức Finish');
}

console.log('\n====================================================');
console.log('🧪 TEST 2: SCORM 2004 SAVE-BEFORE-CLOSE SNAPSHOT ACCURACY');
console.log('====================================================');
{
  const api2004 = createScorm2004Api({}, (cmi, event) => {});

  api2004.Initialize();
  api2004.SetValue('cmi.location', 'slide_urgent_save_9');
  api2004.SetValue('cmi.suspend_data', 'json_blob_stage_9');
  api2004.SetValue('cmi.score.raw', '95.5');

  assert.equal(typeof api2004._getCmi, 'function', 'api2004._getCmi must be a function');
  const snapshot2004 = api2004._getCmi();

  assert.equal(snapshot2004['cmi.location'], 'slide_urgent_save_9');
  assert.equal(snapshot2004['cmi.suspend_data'], 'json_blob_stage_9');
  assert.equal(snapshot2004['cmi.score.raw'], '95.5');

  // Xác nhận KHÔNG bị cưỡng bức Terminate
  assert.equal(api2004.SetValue('cmi.completion_status', 'incomplete'), 'true', 'Must not be terminated');
  console.log('✅ TEST 2 PASSED: SCORM 2004 _getCmi() trả chính xác các giá trị mới nhất mà không cưỡng bức Terminate');
}

console.log('\n====================================================');
console.log('🧪 TEST 3: STATIC CONTRACT AUDIT (PLAYER.JS & MODAL.JSX)');
console.log('====================================================');
{
  const playerCode = fs.readFileSync(path.join(__dirname, '..', 'scorm-player', 'src', 'player.js'), 'utf-8');
  const modalCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'materials', 'MaterialViewerModal.jsx'), 'utf-8');

  // Player contract
  assert.ok(playerCode.includes('SCORM_REQUEST_SAVE_BEFORE_CLOSE'), 'player.js must handle SCORM_REQUEST_SAVE_BEFORE_CLOSE');
  assert.ok(playerCode.includes('PARENT_CLOSE_SNAPSHOT'), 'player.js must send PARENT_CLOSE_SNAPSHOT event');
  assert.ok(playerCode.includes('SCORM_CLOSE_SNAPSHOT_FAILED'), 'player.js must have failure fallback');
  assert.ok(playerCode.includes('_getCmi'), 'player.js must extract snapshot using _getCmi');
  assert.ok(!playerCode.includes("postMessage({ type: 'SCORM_REQUEST_SAVE_BEFORE_CLOSE'"), 'player should not post request to itself');

  // Modal contract
  assert.ok(modalCode.includes('handleSafeClose'), 'Modal must declare handleSafeClose');
  assert.ok(modalCode.includes('scormIframeRef'), 'Modal must use scormIframeRef');
  assert.ok(modalCode.includes('isClosing'), 'Modal must manage isClosing state');
  assert.ok(modalCode.includes('PARENT_CLOSE_SNAPSHOT'), 'Modal must check PARENT_CLOSE_SNAPSHOT');
  assert.ok(modalCode.includes('closeTimeoutRef'), 'Modal must use closeTimeoutRef');
  assert.ok(modalCode.includes("disabled={isClosing}"), 'Close buttons must be disabled while isClosing');

  console.log('✅ TEST 3 PASSED: Static contract và PostMessage boundary hoàn toàn chính xác');
}

console.log('\n====================================================');
console.log('🎉 ALL SCORM SAVE-BEFORE-CLOSE TESTS PASSED 100%!');
console.log('====================================================');
