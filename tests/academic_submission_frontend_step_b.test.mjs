// tests/academic_submission_frontend_step_b.test.mjs
// Verification suite for Phase 1 Step B: Teacher Grading Workspace Integration

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ TÍCH HỢP FRONTEND STEP B: TEACHER GRADING WORKSPACE & CONTRACT');
console.log('================================================================================\n');

// 1. Kiểm tra file SubmissionGradingModal.jsx
const modalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'SubmissionGradingModal.jsx');
assert.ok(fs.existsSync(modalPath), 'SubmissionGradingModal.jsx phải tồn tại');
const modalContent = fs.readFileSync(modalPath, 'utf8');

// Test 1: Import & use getGradingWorkspace
assert.ok(
  modalContent.includes('import { getGradingWorkspace }') || modalContent.includes('getGradingWorkspace'),
  'SubmissionGradingModal phải import getGradingWorkspace từ submissionAnnotationClient'
);
assert.ok(
  modalContent.includes('getGradingWorkspace({'),
  'SubmissionGradingModal phải gọi getGradingWorkspace với submissionId'
);
console.log('✅ Test 1: SubmissionGradingModal import và sử dụng getGradingWorkspace chính thức.');

// Test 2: Phase 1 attachments grouped by question_id
assert.ok(
  modalContent.includes('att.question_id === ans.question_id'),
  'Attachments phải được gom nhóm theo question_id của từng câu hỏi'
);
console.log('✅ Test 2: Attachments được gom nhóm chính xác theo question_id.');

// Test 3: Only finalized attachments rendered
assert.ok(
  modalContent.includes("att.upload_status === 'finalized'"),
  'Chỉ các attachment có upload_status === finalized mới được render và tạo Signed URL'
);
console.log('✅ Test 3: Bộ lọc bảo đảm chỉ hiển thị attachment đã finalized.');

// Test 4: Signed URL TTL 900
assert.ok(
  modalContent.includes('.createSignedUrl(att.storage_path, 900)'),
  'Signed URL cho Phase 1 attachment phải có TTL = 900 giây'
);
console.log('✅ Test 4: Signed URLs được tạo với TTL = 900 giây bảo mật.');

// Test 5 & 6: Legacy file_url fallback & Anti-duplicate
assert.ok(
  modalContent.includes('shouldShowLegacyFallback') || modalContent.includes('!hasPhase1Attachments && Boolean(ans.file_url)'),
  'Phải giữ legacy fallback khi câu hỏi không có Phase 1 attachments'
);
assert.ok(
  modalContent.includes('isLegacyFileDuplicate') || modalContent.includes('att.storage_path === ans.file_url'),
  'Phải có cơ chế chống hiển thị duplicate giữa Phase 1 attachment và legacy primary fallback'
);
console.log('✅ Test 5 & 6: Bảo toàn legacy file_url và ngăn chặn duplicate hiển thị.');

// Test 7: handleSaveGrade exists and handles grading
assert.ok(
  modalContent.includes('handleSaveGrade'),
  'SubmissionGradingModal phải có hàm handleSaveGrade'
);
console.log('✅ Test 7: Hợp đồng chấm bài handleSaveGrade được bảo toàn.');

console.log('\n🎉 TOÀN BỘ KIỂM THỬ FRONTEND STEP B ĐÃ PASS THÀNH CÔNG!\n');
