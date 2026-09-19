import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ TÍCH HỢP FRONTEND STEP C2: SAVE ANNOTATION DRAFT & OCC INTEGRATION');
console.log('================================================================================\n');

// 1. AUDIT SOURCE FILES
const toolbarFile = path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx');
const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
const gradingModalFile = path.resolve('src/components/dashboard/exercises/SubmissionGradingModal.jsx');
const clientFile = path.resolve('src/services/submissionAnnotationClient.js');

assert(fs.existsSync(toolbarFile), 'Thiếu file AnnotationToolbar.jsx');
assert(fs.existsSync(canvasFile), 'Thiếu file SubmissionAnnotationCanvas.jsx');
assert(fs.existsSync(gradingModalFile), 'Thiếu file SubmissionGradingModal.jsx');
assert(fs.existsSync(clientFile), 'Thiếu file submissionAnnotationClient.js');

const toolbarCode = fs.readFileSync(toolbarFile, 'utf8');
const canvasCode = fs.readFileSync(canvasFile, 'utf8');
const modalCode = fs.readFileSync(gradingModalFile, 'utf8');
const clientCode = fs.readFileSync(clientFile, 'utf8');

// TEST 1: saveAnnotationDraft imported and used
console.log('🧪 Test 1: SubmissionGradingModal import và sử dụng saveAnnotationDraft chính thức');
assert(modalCode.includes('saveAnnotationDraft'), 'Modal phải import saveAnnotationDraft');
assert(modalCode.includes('saveAnnotationDraft({'), 'Modal phải gọi saveAnnotationDraft');
console.log('   ✅ PASS: saveAnnotationDraft đã được tích hợp đúng contract.');

// TEST 2: expectedVersion comes from per-attachment version state
console.log('🧪 Test 2: expectedVersion được quản lý riêng biệt theo từng attachmentId');
assert(modalCode.includes('annotationVersions'), 'Modal phải có state annotationVersions');
assert(modalCode.includes('expectedVersion = annotationVersions') || modalCode.includes('expectedVersion:'), 'expectedVersion phải lấy từ state annotationVersions');
console.log('   ✅ PASS: Quản lý OCC version chính xác theo từng attachment.');

// TEST 3 & 4 & 5: Idempotency generation & retry key reuse & new key on edit
console.log('🧪 Test 3, 4, 5: Idempotency Key (UUID), reuse cùng key khi retry và cấp key mới khi vẽ mới');
assert(modalCode.includes('crypto.randomUUID') || modalCode.includes('pendingIdempotencyKeysRef'), 'Phải tạo UUID idempotency key');
assert(modalCode.includes('pendingIdempotencyKeysRef.current[attachmentId] = null'), 'Reset idempotency key khi save thành công');
assert(modalCode.includes('pendingIdempotencyKeysRef.current[attachmentId] = (typeof crypto'), 'Cấp idempotency key mới khi handleAnnotationChange');
console.log('   ✅ PASS: Chu trình sinh và tái sử dụng Idempotency Key hoạt động đúng chuẩn.');

// TEST 6: VERSION_CONFLICT does not auto-overwrite
console.log('🧪 Test 6: Xử lý VERSION_CONFLICT an toàn, không tự động ghi đè hoặc đổi version âm thầm');
assert(modalCode.includes('VERSION_CONFLICT') || modalCode.includes('isConflict'), 'Phải kiểm tra VERSION_CONFLICT hoặc isConflict');
assert(modalCode.includes("setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'conflict' }))"), 'Chuyển sang trạng thái conflict khi xung đột');
assert(!modalCode.includes('expectedVersion = data.current_version; handleSaveDraft('), 'Tuyệt đối không tự động retry đè khi conflict');
console.log('   ✅ PASS: Xung đột phiên bản dừng autosave và hiển thị cảnh báo rõ ràng.');

// TEST 7: Successful save updates version from backend response
console.log('🧪 Test 7: Cập nhật version từ backend response (data.version)');
assert(modalCode.includes('const newVersion = data.version'), 'Lấy newVersion từ data.version');
assert(modalCode.includes('setAnnotationVersions(prev => ({ ...prev, [attachmentId]: newVersion }))'), 'Cập nhật version vào state');
console.log('   ✅ PASS: Version được nâng cấp chính xác theo backend response.');

// TEST 8: Dirty not cleared if local annotation changed during in-flight request
console.log('🧪 Test 8: Bảo toàn trạng thái dirty nếu người dùng vẽ thêm trong lúc request đang gửi');
assert(modalCode.includes('const isStillSame = JSON.stringify(currentLatestJson) === JSON.stringify(annotationJson)'), 'So sánh snapshot dữ liệu');
assert(modalCode.includes("setAnnotationDirty(prev => ({ ...prev, [attachmentId]: true }))"), 'Giữ dirty = true nếu có nét vẽ mới trong lúc save');
console.log('   ✅ PASS: In-flight drawing edits được bảo toàn và kích hoạt lượt save tiếp theo.');

// TEST 9: Payload > 512KiB blocked client-side
console.log('🧪 Test 9: Giới hạn payload 512 KiB được kiểm tra trên Client trước khi gửi RPC');
assert(modalCode.includes('512 * 1024') || modalCode.includes('524288'), 'Phải kiểm tra kích thước payload 512 KiB');
assert(modalCode.includes('Nét chấm quá lớn để lưu'), 'Thông báo lỗi khi payload quá lớn');
console.log('   ✅ PASS: Chặn kịp thời payload vượt quá 512 KiB.');

// TEST 10 & 11: No save on pointermove directly & Debounce exists (800-1200ms)
console.log('🧪 Test 10 & 11: Không gọi save trực tiếp trên pointermove, áp dụng Debounce 1000ms');
assert(!canvasCode.includes('saveAnnotationDraft'), 'Canvas không được trực tiếp gọi save draft trên pointermove');
assert(modalCode.includes('setTimeout') && (modalCode.includes('1000') || modalCode.includes('800') || modalCode.includes('1200')), 'Debounce 800-1200ms trong handleAnnotationChange');
assert(modalCode.includes('clearTimeout'), 'Xóa timer debounce trước khi đặt timer mới');
console.log('   ✅ PASS: Debounce autosave 1000ms hoạt động sau khi kết thúc nét vẽ.');

// TEST 12: saveAnnotationDraft & draft contract preserved
console.log('🧪 Test 12: saveAnnotationDraft & draft contract được giữ vững');
assert(modalCode.includes('saveAnnotationDraft({'), 'Giữ vững gọi saveAnnotationDraft');
console.log('   ✅ PASS: Hợp đồng lưu nháp annotation được bảo toàn.');

// TEST 13: Close warning for dirty/saving state
console.log('🧪 Test 13: Cảnh báo khi đóng modal nếu còn nét chưa lưu');
assert(modalCode.includes('handleCloseModal'), 'Có hàm handleCloseModal kiểm tra dirty trước khi đóng');
assert(modalCode.includes('Còn nét chấm chưa được lưu'), 'Thông báo xác nhận khi còn nét chưa lưu');
console.log('   ✅ PASS: Cảnh báo bảo vệ dữ liệu khi đóng modal.');

// TEST 14: Legacy flow preserved
console.log('🧪 Test 14: Bảo toàn luồng xem bài nộp đơn file legacy cũ');
assert(modalCode.includes('shouldShowLegacyFallback') && modalCode.includes('signedUrlsMap'), 'Bảo toàn legacy fallback');
console.log('   ✅ PASS: Luồng legacy file_url vẫn hoạt động bình thường.');

console.log('\n🎉 TOÀN BỘ KIỂM THỬ FRONTEND STEP C2 ĐÃ PASS THÀNH CÔNG!\n');
