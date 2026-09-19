import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ TÍCH HỢP FRONTEND STEP C1: NATIVE ANNOTATION CANVAS & CONTRACT');
console.log('================================================================================\n');

const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
const toolbarFile = path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx');
const gradingModalFile = path.resolve('src/components/dashboard/exercises/SubmissionGradingModal.jsx');

assert(fs.existsSync(canvasFile), 'Thiếu file SubmissionAnnotationCanvas.jsx');
assert(fs.existsSync(toolbarFile), 'Thiếu file AnnotationToolbar.jsx');
assert(fs.existsSync(gradingModalFile), 'Thiếu file SubmissionGradingModal.jsx');

const canvasCode = fs.readFileSync(canvasFile, 'utf8');
const toolbarCode = fs.readFileSync(toolbarFile, 'utf8');
const modalCode = fs.readFileSync(gradingModalFile, 'utf8');

// TEST 1: Normalized coordinate conversion exists & clamps in [0, 1]
console.log('🧪 Test 1: Bắt buộc chuẩn hóa tọa độ (Normalized Coordinates 0..1) có clamp');
assert(canvasCode.includes('getBoundingClientRect()'), 'SubmissionAnnotationCanvas phải lấy kích thước khung qua getBoundingClientRect()');
assert(canvasCode.includes('clientX - rect.left') && canvasCode.includes('clientY - rect.top'), 'Phải tính relative offset từ clientX/clientY');
assert(canvasCode.includes('Math.max(0, Math.min(1,'), 'Phải clamp nghiêm ngặt tọa độ trong khoảng [0, 1]');
console.log('   ✅ PASS: Tọa độ được chuẩn hóa [0, 1] và clamp chặt chẽ.');

// TEST 2: No absolute pixel coordinates persisted as source of truth
console.log('🧪 Test 2: Không lưu tọa độ pixel tuyệt đối làm nguồn dữ liệu chính');
assert(!canvasCode.includes('intrinsicWidth') && !canvasCode.includes('naturalWidth'), 'Không dùng kích thước ảnh gốc làm đơn vị lưu');
assert(canvasCode.includes('viewBox="0 0 1000 1000"'), 'SVG overlay phải sử dụng hệ tọa độ chuẩn viewBox 0 0 1000 1000');
console.log('   ✅ PASS: Không lưu pixel cứng, SVG scale phân giải độc lập 1000x1000.');

// TEST 3: Pointer events present (touch-action: none, pointerdown/move/up/cancel)
console.log('🧪 Test 3: Hỗ trợ đầy đủ Pointer Events (Mouse, Touch, Pen) & chặn cuộn màn hình');
assert(canvasCode.includes('onPointerDown') && canvasCode.includes('onPointerMove'), 'Phải có onPointerDown và onPointerMove');
assert(canvasCode.includes('onPointerUp') && canvasCode.includes('onPointerCancel'), 'Phải có onPointerUp và onPointerCancel');
assert(canvasCode.includes("touchAction: 'none'") || canvasCode.includes('touch-none'), 'Phải vô hiệu hóa touch action để tránh cuộn trang khi vẽ');
console.log('   ✅ PASS: Pointer events và touch-action đã được cấu hình đầy đủ.');

// TEST 4: Annotation schema có schema_version, strokes, stamps, notes
console.log('🧪 Test 4: Cấu trúc schema annotation tuân thủ hợp đồng Phase 1');
assert(canvasCode.includes('schema_version') || modalCode.includes('schema_version'), 'Schema phải có trường schema_version');
assert(canvasCode.includes('strokes') && canvasCode.includes('stamps'), 'Schema phải hỗ trợ strokes và stamps');
console.log('   ✅ PASS: Cấu trúc JSON Schema annotation đầy đủ các phần tử.');

// TEST 5: SubmissionGradingModal quản lý annotation theo attachment id
console.log('🧪 Test 5: SubmissionGradingModal quản lý annotations theo attachmentId');
assert(modalCode.includes('annotationsByAttachment'), 'Modal phải có state annotationsByAttachment');
assert(modalCode.includes('SubmissionAnnotationCanvas') && modalCode.includes('AnnotationToolbar'), 'Modal phải import và render Canvas + Toolbar');
assert(modalCode.includes('handleAnnotationChange'), 'Modal phải có hàm cập nhật nét vẽ');
console.log('   ✅ PASS: State annotation được phân tách chính xác theo từng attachment.');

// TEST 6: Legacy file flow remains intact
console.log('🧪 Test 6: Bảo toàn luồng xem file bài nộp legacy cũ');
assert(modalCode.includes('shouldShowLegacyFallback') && modalCode.includes('signedUrlsMap'), 'Phải bảo toàn fallback file_url legacy');
console.log('   ✅ PASS: Luồng legacy file_url vẫn nguyên vẹn.');

// TEST 7: SubmissionAnnotationCanvas does not trigger saveAnnotationDraft directly
console.log('🧪 Test 7: Canvas không trực tiếp gọi saveAnnotationDraft (Phân tách trách nhiệm)');
assert(!canvasCode.includes('saveAnnotationDraft('), 'SubmissionAnnotationCanvas tuyệt đối không gọi saveAnnotationDraft');
console.log('   ✅ PASS: SubmissionAnnotationCanvas là thành phần thuần UI, không gọi trực tiếp RPC.');

// TEST 8: Canvas separation of concerns preserved
console.log('🧪 Test 8: Canvas và modal phân tách rõ ràng trách nhiệm');
assert(!canvasCode.includes('finalizeGradingWithAnnotations'), 'Canvas tuyệt đối không gọi finalizeGradingWithAnnotations');
assert(modalCode.includes('handleSaveGrade'), 'Modal quản lý logic chấm bài tập trung');
console.log('   ✅ PASS: Phân tách trách nhiệm UI Canvas và Modal hoàn tất.');

console.log('\n🎉 TOÀN BỘ KIỂM THỬ FRONTEND STEP C1 ĐÃ PASS THÀNH CÔNG!\n');
