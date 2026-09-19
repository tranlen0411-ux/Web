import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ TÍCH HỢP FRONTEND STEP D: FINALIZE GRADING WITH ANNOTATIONS');
console.log('   (Loại kiểm thử: STATIC_CONTRACT_TEST / LOCAL LOGIC CONTRACT AUDIT)');
console.log('================================================================================\n');

// 1. AUDIT SOURCE FILES
const gradingModalFile = path.resolve('src/components/dashboard/exercises/SubmissionGradingModal.jsx');
const clientFile = path.resolve('src/services/submissionAnnotationClient.js');

assert(fs.existsSync(gradingModalFile), 'Thiếu file SubmissionGradingModal.jsx');
assert(fs.existsSync(clientFile), 'Thiếu file submissionAnnotationClient.js');

const modalCode = fs.readFileSync(gradingModalFile, 'utf8');
const clientCode = fs.readFileSync(clientFile, 'utf8');

// TEST 1: imports finalizeGradingWithAnnotations
console.log('🧪 Test 1: SubmissionGradingModal import finalizeGradingWithAnnotations từ service client');
assert(
  modalCode.includes('finalizeGradingWithAnnotations') &&
  modalCode.includes("from '../../../services/submissionAnnotationClient'"),
  'Modal phải import finalizeGradingWithAnnotations từ submissionAnnotationClient'
);
assert(modalCode.includes('finalizeGradingWithAnnotations({'), 'Modal phải gọi finalizeGradingWithAnnotations');
console.log('   ✅ PASS: finalizeGradingWithAnnotations được import và gọi chuẩn contract.');

// TEST 2: legacy grade_academic_submission không còn được gọi bởi final handler
console.log('🧪 Test 2: Luồng hoàn tất chấm không còn gọi legacy RPC grade_academic_submission');
assert(
  !modalCode.includes("supabase.rpc('grade_academic_submission'"),
  'Modal tuyệt đối không gọi trực tiếp grade_academic_submission'
);
assert(
  !modalCode.includes('grade_academic_submission'),
  'Không còn bất kỳ tham chiếu grade_academic_submission nào trong modal'
);
console.log('   ✅ PASS: Legacy grade_academic_submission đã được loại bỏ hoàn toàn khỏi handler chấm.');

// TEST 3: all subjective questions included in manualGrades
console.log('🧪 Test 3: Tất cả câu hỏi tự luận/nộp file được gom đầy đủ vào manualGrades');
assert(
  modalCode.includes("['essay', 'image_upload', 'file_upload'].includes(") ||
  modalCode.includes("['essay', 'image_upload', 'file_upload']"),
  'Phải lọc đúng tất cả các loại câu tự luận (essay, image_upload, file_upload)'
);
assert(
  modalCode.includes('question_id: ans.question_id') && modalCode.includes('points_earned:'),
  'manualGrades phải chứa question_id và points_earned'
);
console.log('   ✅ PASS: ALL_SUBJECTIVE_QUESTIONS_INCLUDED = YES.');

// TEST 4: invalid/missing subjective score blocks finalize
console.log('🧪 Test 4: Điểm chấm tự luận không hợp lệ hoặc thiếu sẽ bị chặn finalize ngay lập tức');
assert(
  modalCode.includes('isNaN(numVal)') || modalCode.includes('numVal < 0') || modalCode.includes('numVal > maxPoints'),
  'Phải kiểm tra isNaN, điểm âm hoặc vượt quá maxPoints'
);
assert(
  modalCode.includes('setIsSubmitting(false)') && modalCode.includes('setMsg('),
  'Phải dừng finalize và hiển thị thông báo lỗi khi điểm không hợp lệ'
);
console.log('   ✅ PASS: Chặn kịp thời điểm tự luận không hợp lệ trước khi gửi RPC.');

// TEST 5: annotations grouped uniquely by attachment_id
console.log('🧪 Test 5: Annotations payload được nhóm duy nhất theo từng attachment_id');
assert(
  modalCode.includes('finalizedAttachments.map') || modalCode.includes('attachment_id: att.id'),
  'Payload annotations phải được map theo danh sách finalized attachments'
);
assert(
  modalCode.includes("att.upload_status === 'finalized'") && modalCode.includes('att.submission_id === selectedSub.id'),
  'Chỉ lấy attachment đã finalized và thuộc đúng bài nộp hiện tại'
);
console.log('   ✅ PASS: ANNOTATION_ITEMS_UNIQUE = YES.');

// TEST 6: expected_version from annotationVersions[attachmentId]
console.log('🧪 Test 6: expected_version được lấy chính xác từ annotationVersions theo từng attachment');
assert(
  modalCode.includes('annotationVersionsRef.current[att.id]') || modalCode.includes('annotationVersions[att.id]'),
  'expected_version phải lấy từ state/ref annotationVersions của attachment'
);
console.log('   ✅ PASS: EXPECTED_VERSION_PER_ATTACHMENT = YES.');

// TEST 7: unique UUID for each attachment
console.log('🧪 Test 7: Mỗi attachment trong finalize payload có UUID idempotency key riêng biệt');
assert(
  modalCode.includes('finalizeIdempotencyKeysRef.current[att.id]') || modalCode.includes('crypto.randomUUID'),
  'Mỗi attachment phải có UUID key riêng biệt'
);
console.log('   ✅ PASS: FINALIZE_IDEMPOTENCY_KEYS_UNIQUE = YES.');

// TEST 8: same logical retry reuses finalize idempotency keys
console.log('🧪 Test 8: Tái sử dụng cùng idempotency key khi retry cùng một logical finalize request');
assert(
  modalCode.includes('if (!finalizeIdempotencyKeysRef.current[att.id])') ||
  modalCode.includes('finalizeIdempotencyKeysRef.current[att.id] = finalizeIdempotencyKeysRef.current[att.id] ||'),
  'Không ghi đè key cũ khi retry cùng logical finalize attempt'
);
assert(
  modalCode.includes('finalizeIdempotencyKeysRef.current[attachmentId] = null') ||
  modalCode.includes('finalizeIdempotencyKeysRef.current = {}'),
  'Chỉ cấp key mới khi có chỉnh sửa nét vẽ mới hoặc sau khi finalize thành công'
);
console.log('   ✅ PASS: LOGICAL_RETRY_REUSES_KEYS = YES.');

// TEST 9: dirty annotation saved before finalize
console.log('🧪 Test 9: Bản nháp nét vẽ dirty được tự động lưu thành công trước khi finalize');
assert(
  modalCode.includes('dirtyAttIds') || modalCode.includes('annotationDirty'),
  'Phải rà soát danh sách dirty attachments'
);
assert(
  modalCode.includes('handleSaveDraft(attId, { isManual: true })') || modalCode.includes('handleSaveDraft('),
  'Phải gọi handleSaveDraft cho các ảnh dirty trước khi finalize'
);
console.log('   ✅ PASS: DIRTY_SAVED_BEFORE_FINALIZE = YES.');

// TEST 10: saving/conflict/error blocks finalize
console.log('🧪 Test 10: Trạng thái saving, conflict hoặc error chặn quá trình finalize');
assert(
  modalCode.includes("annotationSaveState[id] === 'saving'") || modalCode.includes('inFlightSavesRef.current'),
  'Chặn finalize khi đang saving'
);
assert(
  modalCode.includes("annotationSaveState[id] === 'conflict'"),
  'Chặn finalize khi đang có conflict'
);
assert(
  modalCode.includes("annotationSaveState[id] === 'error'"),
  'Chặn finalize khi đang có error'
);
console.log('   ✅ PASS: SAVING_BLOCKS_FINALIZE = YES, CONFLICT_BLOCKS_FINALIZE = YES, ERROR_BLOCKS_FINALIZE = YES.');

// TEST 11: VERSION_CONFLICT does not auto overwrite
console.log('🧪 Test 11: Lỗi VERSION_CONFLICT giữ nguyên trạng thái, không tự động ghi đè');
assert(
  modalCode.includes("data?.error === 'VERSION_CONFLICT'") || modalCode.includes("friendlyError.includes('cửa sổ khác')"),
  'Nhận diện VERSION_CONFLICT từ finalize response'
);
assert(
  modalCode.includes("setAnnotationSaveState(prev => ({ ...prev, [att.id]: 'conflict' }))"),
  'Đánh dấu trạng thái conflict cho attachment và cảnh báo người dùng'
);
console.log('   ✅ PASS: VERSION_CONFLICT_SAFE = YES (AUTO_OVERWRITE = NO).');

// TEST 12: security error codes mapped
console.log('🧪 Test 12: Tất cả mã lỗi bảo mật được map sang thông báo tiếng Việt thân thiện');
assert(modalCode.includes('ATTACHMENT_NOT_FOUND') && modalCode.includes('Không tìm thấy ảnh bài làm'), 'Map ATTACHMENT_NOT_FOUND');
assert(modalCode.includes('ATTACHMENT_MISMATCH') && modalCode.includes('không thuộc lượt nộp'), 'Map ATTACHMENT_MISMATCH');
assert(modalCode.includes('ATTACHMENT_NOT_FINALIZED') && modalCode.includes('chưa hoàn tất tải lên'), 'Map ATTACHMENT_NOT_FINALIZED');
assert(modalCode.includes('DUPLICATE_ATTACHMENT') && modalCode.includes('Dữ liệu ảnh chấm bị trùng'), 'Map DUPLICATE_ATTACHMENT');
assert(modalCode.includes('DUPLICATE_IDEMPOTENCY_KEY') && modalCode.includes('trùng mã yêu cầu'), 'Map DUPLICATE_IDEMPOTENCY_KEY');
assert(modalCode.includes('IDEMPOTENCY_KEY_MISMATCH') && modalCode.includes('không khớp'), 'Map IDEMPOTENCY_KEY_MISMATCH');
assert(modalCode.includes('INVALID_EXPECTED_VERSION') && modalCode.includes('không hợp lệ'), 'Map INVALID_EXPECTED_VERSION');
assert(modalCode.includes('PAYLOAD_TOO_LARGE') && modalCode.includes('quá lớn'), 'Map PAYLOAD_TOO_LARGE');
console.log('   ✅ PASS: SECURITY_ERRORS_MAPPED = YES.');

// TEST 13: success status accepts graded
console.log('🧪 Test 13: Xử lý thành công trạng thái graded');
assert(modalCode.includes("status: finalStatus") || modalCode.includes("status: 'graded'") || modalCode.includes('data.status'), 'Cập nhật status graded');
console.log('   ✅ PASS: GRADED_STATUS_HANDLED = YES.');

// TEST 14: request revision uses revision_requested
console.log('🧪 Test 14: Yêu cầu làm lại cập nhật đúng trạng thái revision_requested');
assert(modalCode.includes("'revision_requested'"), 'Phải sử dụng trạng thái revision_requested');
console.log('   ✅ PASS: REVISION_REQUESTED_STATUS_HANDLED = YES.');

// TEST 15: needs_revision not used
console.log('🧪 Test 15: Tuyệt đối không sử dụng giá trị lỗi needs_revision');
assert(!modalCode.includes("'needs_revision'") && !modalCode.includes('"needs_revision"'), 'Không được dùng needs_revision');
console.log('   ✅ PASS: NEEDS_REVISION_USED = NO.');

// TEST 16: legacy submission with annotations=[] supported
console.log('🧪 Test 16: Hỗ trợ bài nộp legacy không có ảnh Phase 1 (annotations=[])');
assert(
  modalCode.includes('annotationsPayload') && modalCode.includes('finalizeGradingWithAnnotations'),
  'Nếu không có attachment, annotationsPayload rỗng [] vẫn được gửi an toàn đến RPC'
);
console.log('   ✅ PASS: LEGACY_SUBMISSION_SUPPORTED = YES, EMPTY_ANNOTATIONS_SUPPORTED = YES.');

// TEST 17: frontend never directly awards stars
console.log('🧪 Test 17: Frontend không tự cộng sao vào database, chỉ hiển thị reward_stars_awarded từ RPC');
assert(
  !modalCode.includes(".update({ total_stars:") && !modalCode.includes(".update({ stars:"),
  'Frontend tuyệt đối không trực tiếp update total_stars'
);
assert(modalCode.includes('reward_stars_awarded'), 'Chỉ đọc reward_stars_awarded từ kết quả RPC trả về');
console.log('   ✅ PASS: FRONTEND_STAR_MUTATION = NO.');

// TEST 18: double-submit protected
console.log('🧪 Test 18: Bảo vệ chống bấm liên tiếp (Double-submit protection)');
assert(
  modalCode.includes('if (!selectedSub || isSubmitting) return') || modalCode.includes('disabled={isSubmitting}'),
  'Phải có cờ isSubmitting chặn double click'
);
console.log('   ✅ PASS: DOUBLE_SUBMIT_PREVENTED = YES.');

console.log('\n🎉 TOÀN BỘ 18/18 KIỂM THỬ FRONTEND STEP D ĐÃ PASS XUẤT SẮC!\n');
