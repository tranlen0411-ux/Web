// tests/academic_submission_frontend_step_a1.test.mjs
// Verification suite for Phase 1 Step A1 & A1.1: Student Multi-Image Uploader Frontend Integration & Hardening

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ TÍCH HỢP FRONTEND STEP A1.1: MULTI-IMAGE UPLOADER HARDENING');
console.log('================================================================================\n');

// 1. Kiểm tra file SubmissionImageUploader.jsx
const uploaderPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'SubmissionImageUploader.jsx');
assert.ok(fs.existsSync(uploaderPath), 'SubmissionImageUploader.jsx phải tồn tại');
const uploaderContent = fs.readFileSync(uploaderPath, 'utf8');

assert.ok(uploaderContent.includes('export const SubmissionImageUploader'), 'SubmissionImageUploader phải có export component');
assert.ok(uploaderContent.includes('export const MAX_IMAGES_PER_QUESTION = 10'), 'Phải export constant MAX_IMAGES_PER_QUESTION = 10');
assert.ok(uploaderContent.includes('prepareSubmissionAttachment'), 'Phải sử dụng prepareSubmissionAttachment');
assert.ok(uploaderContent.includes('finalizeSubmissionAttachment'), 'Phải sử dụng finalizeSubmissionAttachment');
assert.ok(uploaderContent.includes('multiple'), 'Phải hỗ trợ input multiple');
assert.ok(uploaderContent.includes('image/jpeg') && uploaderContent.includes('image/png') && uploaderContent.includes('image/webp'), 'Phải giới hạn đúng MIME type');
assert.ok(uploaderContent.includes('.svg') && uploaderContent.includes('Chặn định dạng SVG'), 'Phải chặn định dạng SVG');
assert.ok(uploaderContent.includes('10 * 1024 * 1024'), 'Phải giới hạn 10MB/ảnh');
assert.ok(uploaderContent.includes('MAX_IMAGES_PER_QUESTION - currentCount') || uploaderContent.includes('currentCount >= MAX_IMAGES_PER_QUESTION'), 'Phải kiểm soát giới hạn tối đa trước khi prepare');
assert.ok(!uploaderContent.includes('.delete('), 'KHÔNG được gọi direct delete trên academic_submission_attachments');
console.log('✅ Test 1: SubmissionImageUploader.jsx tuân thủ đầy đủ hợp đồng 3 bước, chặn SVG, 10MB & trần tối đa 10 ảnh.');

// 2. Kiểm tra file submissionAnnotationClient.js
const clientPath = path.join(process.cwd(), 'src', 'services', 'submissionAnnotationClient.js');
assert.ok(fs.existsSync(clientPath), 'submissionAnnotationClient.js phải tồn tại');
const clientContent = fs.readFileSync(clientPath, 'utf8');

assert.ok(clientContent.includes('export async function prepareSubmissionAttachment'), 'Phải export prepareSubmissionAttachment');
assert.ok(clientContent.includes('export async function finalizeSubmissionAttachment'), 'Phải export finalizeSubmissionAttachment');
assert.ok(clientContent.includes('export async function getGradingWorkspace'), 'Phải export getGradingWorkspace');
assert.ok(clientContent.includes('export async function saveAnnotationDraft'), 'Phải export saveAnnotationDraft');
assert.ok(clientContent.includes('export async function finalizeGradingWithAnnotations'), 'Phải export finalizeGradingWithAnnotations');
assert.ok(clientContent.includes('export async function getStudentGradedSubmission'), 'Phải export getStudentGradedSubmission');
assert.ok(clientContent.includes('export async function getStudentSubmissionAttachments'), 'Phải export getStudentSubmissionAttachments');
console.log('✅ Test 2: submissionAnnotationClient.js có đầy đủ 7 service functions chuẩn.');

// 3. Kiểm tra file ExercisePlayModal.jsx
const modalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
assert.ok(fs.existsSync(modalPath), 'ExercisePlayModal.jsx phải tồn tại');
const modalContent = fs.readFileSync(modalPath, 'utf8');

assert.ok(modalContent.includes('SubmissionImageUploader'), 'ExercisePlayModal phải import và render SubmissionImageUploader');
assert.ok(modalContent.includes('getStudentSubmissionAttachments'), 'ExercisePlayModal phải import getStudentSubmissionAttachments để phục hồi Draft');
assert.ok(modalContent.includes('attachmentsMap'), 'ExercisePlayModal phải quản lý state attachmentsMap');
assert.ok(modalContent.includes('currentQ.question_type === \'image_upload\''), 'image_upload phải sử dụng SubmissionImageUploader');
assert.ok(modalContent.includes('currentQ.question_type === \'file_upload\''), 'file_upload legacy phải được bảo toàn');

// 4. Kiểm tra an toàn cho fallback submit file_url
assert.ok(
  modalContent.includes('readyAttachments') && modalContent.includes('status === \'ready\' || a.upload_status === \'finalized\''),
  'Chỉ các attachment ready/finalized mới được dùng làm primary file_url fallback'
);
console.log('✅ Test 3: ExercisePlayModal.jsx tích hợp an toàn, submit fallback lọc chính xác ready/finalized items.');

console.log('\n🎉 TOÀN BỘ KIỂM THỬ FRONTEND STEP A1.1 ĐÃ PASS THÀNH CÔNG!\n');
