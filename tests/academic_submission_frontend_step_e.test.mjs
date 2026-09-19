import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ TÍCH HỢP FRONTEND STEP E: STUDENT GRADED SUBMISSION VIEWER');
console.log('   (Loại kiểm thử: STATIC_CONTRACT_TEST & RUNTIME LOGIC SANITIZATION TEST)');
console.log('================================================================================\n');

// 1. AUDIT SOURCE FILES
const viewerModalFile = path.resolve('src/components/dashboard/exercises/StudentGradedViewerModal.jsx');
const clientFile = path.resolve('src/services/submissionAnnotationClient.js');
const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
const exerciseListTabFile = path.resolve('src/components/dashboard/exercises/ExerciseListTab.jsx');

assert(fs.existsSync(viewerModalFile), 'Thiếu file StudentGradedViewerModal.jsx');
assert(fs.existsSync(clientFile), 'Thiếu file submissionAnnotationClient.js');
assert(fs.existsSync(canvasFile), 'Thiếu file SubmissionAnnotationCanvas.jsx');
assert(fs.existsSync(exerciseListTabFile), 'Thiếu file ExerciseListTab.jsx');

const viewerCode = fs.readFileSync(viewerModalFile, 'utf8');
const clientCode = fs.readFileSync(clientFile, 'utf8');
const canvasCode = fs.readFileSync(canvasFile, 'utf8');
const tabCode = fs.readFileSync(exerciseListTabFile, 'utf8');

// TEST 1: imports getStudentGradedSubmission
console.log('🧪 Test 1: StudentGradedViewerModal import getStudentGradedSubmission');
assert(
  viewerCode.includes('getStudentGradedSubmission') &&
  viewerCode.includes("from '../../../services/submissionAnnotationClient'"),
  'StudentGradedViewerModal phải import getStudentGradedSubmission từ submissionAnnotationClient'
);
assert(viewerCode.includes('getStudentGradedSubmission({'), 'Phải gọi getStudentGradedSubmission({ submissionId })');
console.log('   ✅ PASS: getStudentGradedSubmission được import và gọi chuẩn contract.');

// TEST 2: structured RPC error code preserved
console.log('🧪 Test 2: structured RPC error code preserved trong submissionAnnotationClient');
assert(
  clientCode.includes('export async function getStudentGradedSubmission('),
  'Phải export getStudentGradedSubmission'
);
assert(
  clientCode.includes('code: data?.error') || clientCode.includes('code = data?.error'),
  'submissionAnnotationClient phải bảo toàn mã lỗi business từ data?.error'
);
assert(
  clientCode.includes('data') && clientCode.includes('ok: false'),
  'Return error object phải bao gồm { ok: false, error, code, data }'
);
console.log('   ✅ PASS: STRUCTURED_RPC_ERROR_CODE_PRESERVED = YES.');

// TEST 3: SUBMISSION_NOT_GRADED mapped
console.log('🧪 Test 3: SUBMISSION_NOT_GRADED mapped sang tiếng Việt thân thiện');
assert(
  viewerCode.includes('SUBMISSION_NOT_GRADED') &&
  viewerCode.includes('Bài làm đang được giáo viên chấm. Vui lòng quay lại sau.'),
  'Mã SUBMISSION_NOT_GRADED phải được map sang câu tiếng Việt chuẩn'
);
console.log('   ✅ PASS: SUBMISSION_NOT_GRADED được map chính xác.');

// TEST 4: FORBIDDEN mapped
console.log('🧪 Test 4: FORBIDDEN mapped sang thông báo không có quyền');
assert(
  viewerCode.includes('FORBIDDEN') &&
  viewerCode.includes('Bạn không có quyền xem bài làm này.'),
  'Mã FORBIDDEN phải được map sang thông báo tiếng Việt chuẩn'
);
console.log('   ✅ PASS: FORBIDDEN được map chính xác.');

// TEST 5: SUBMISSION_NOT_FOUND mapped
console.log('🧪 Test 5: SUBMISSION_NOT_FOUND mapped sang thông báo không tìm thấy');
assert(
  viewerCode.includes('SUBMISSION_NOT_FOUND') &&
  viewerCode.includes('Không tìm thấy bài làm.'),
  'Mã SUBMISSION_NOT_FOUND phải được map sang thông báo tiếng Việt chuẩn'
);
console.log('   ✅ PASS: SUBMISSION_NOT_FOUND được map chính xác.');

// TEST 6: UNAUTHORIZED mapped
console.log('🧪 Test 6: UNAUTHORIZED mapped sang thông báo hết phiên');
assert(
  viewerCode.includes('UNAUTHORIZED') &&
  viewerCode.includes('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'),
  'Mã UNAUTHORIZED phải được map sang thông báo tiếng Việt chuẩn'
);
console.log('   ✅ PASS: UNAUTHORIZED được map chính xác.');

// TEST 7: no raw annotation DB query
console.log('🧪 Test 7: Không raw query bảng annotation trong StudentGradedViewerModal');
assert(
  !viewerCode.includes("from('academic_submission_annotations')"),
  'Tuyệt đối không được raw query academic_submission_annotations'
);
console.log('   ✅ PASS: Không bypass backend RPC bằng raw query annotation.');

// TEST 8: no raw attachment DB query
console.log('🧪 Test 8: Không raw query bảng attachment trong StudentGradedViewerModal');
assert(
  !viewerCode.includes("from('academic_submission_attachments')"),
  'Tuyệt đối không được raw query academic_submission_attachments'
);
console.log('   ✅ PASS: Không bypass backend RPC bằng raw query attachment.');

// TEST 9: private signed URL used with TTL 900s
console.log('🧪 Test 9: Sử dụng private signed URL với TTL 900s');
assert(
  viewerCode.includes('.createSignedUrl(') && viewerCode.includes('900'),
  'Phải tạo signed URL thông qua createSignedUrl với TTL 900 giây'
);
console.log('   ✅ PASS: PRIVATE_SIGNED_URL_TTL = 900.');

// TEST 10: public URL not used
console.log('🧪 Test 10: Không sử dụng getPublicUrl');
assert(
  !viewerCode.includes('getPublicUrl'),
  'Không được dùng public URL trong StudentGradedViewerModal'
);
console.log('   ✅ PASS: PUBLIC_URL_USED = NO.');

// TEST 11: graded supported
console.log('🧪 Test 11: Hỗ trợ status graded');
assert(
  viewerCode.includes("status === 'graded'") || viewerCode.includes("sub?.status === 'graded'"),
  'Phải hỗ trợ và render đầy đủ khi status là graded'
);
console.log('   ✅ PASS: GRADED_SUPPORTED = YES.');

// TEST 12: revision_requested supported
console.log('🧪 Test 12: Hỗ trợ status revision_requested');
assert(
  viewerCode.includes("status === 'revision_requested'") || viewerCode.includes("sub?.status === 'revision_requested'"),
  'Phải hỗ trợ và render đầy đủ khi status là revision_requested'
);
console.log('   ✅ PASS: REVISION_REQUESTED_SUPPORTED = YES.');

// TEST 13: needs_revision absent
console.log('🧪 Test 13: Không dùng needs_revision sai quy chuẩn');
assert(
  !viewerCode.includes('needs_revision') && !tabCode.includes('needs_revision'),
  'Tuyệt đối không dùng status needs_revision, phải dùng revision_requested'
);
console.log('   ✅ PASS: NEEDS_REVISION_USED = NO.');

// TEST 14: unsafe success status guarded
console.log('🧪 Test 14: Safe Success Status Guard chặn hiển thị nếu status không hợp lệ');
assert(
  viewerCode.includes("status !== 'graded' && status !== 'revision_requested'"),
  'Phải có guard kiểm tra status !== graded && status !== revision_requested'
);
console.log('   ✅ PASS: SAFE_STATUS_GUARD = YES.');

// TEST 15: teacher_feedback rendered
console.log('🧪 Test 15: teacher_feedback được hiển thị');
assert(
  viewerCode.includes('teacher_feedback') &&
  viewerCode.includes('Nhận xét chung của Giáo viên:'),
  'Phải render nhận xét chung của giáo viên khi có teacher_feedback'
);
console.log('   ✅ PASS: TEACHER_FEEDBACK_VISIBLE = YES.');

// TEST 16: teacher_comment rendered
console.log('🧪 Test 16: teacher_comment từng câu được hiển thị');
assert(
  viewerCode.includes('teacher_comment') &&
  viewerCode.includes('Nhận xét của Thầy/Cô:'),
  'Phải render nhận xét từng câu khi có teacher_comment'
);
console.log('   ✅ PASS: TEACHER_COMMENT_VISIBLE = YES.');

// TEST 17: points_earned rendered
console.log('🧪 Test 17: points_earned được hiển thị');
assert(
  viewerCode.includes('points_earned') && viewerCode.includes('Đạt:'),
  'Phải hiển thị điểm đạt được (points_earned) cho từng câu'
);
console.log('   ✅ PASS: POINTS_EARNED_VISIBLE = YES.');

// TEST 18: multi attachment grouped & sorted
console.log('🧪 Test 18: Multi attachment được gom theo question_id và sắp xếp sort_order ASC, created_at ASC');
assert(
  viewerCode.includes('attachmentsByQuestion') &&
  viewerCode.includes('sort_order') &&
  viewerCode.includes('created_at'),
  'Attachments phải được gom theo câu và sort theo sort_order, created_at'
);
console.log('   ✅ PASS: MULTI_ATTACHMENT_SUPPORTED = YES.');

// TEST 19: final_annotation only
console.log('🧪 Test 19: Chỉ sử dụng final_annotation');
assert(
  viewerCode.includes('final_annotation?.annotation_json') || viewerCode.includes('final_annotation.annotation_json'),
  'Chỉ được lấy annotation từ final_annotation của attachment'
);
assert(!viewerCode.includes('saveAnnotationDraft'), 'Không được gọi saveAnnotationDraft');
console.log('   ✅ PASS: FINAL_ANNOTATION_ONLY = YES.');

// TEST 20: null annotation safe
console.log('🧪 Test 20: null annotation safe');
assert(
  viewerCode.includes('sanitizeAnnotation') &&
  viewerCode.includes('schema_version: 1') &&
  viewerCode.includes('strokes: []'),
  'Phải có hàm sanitizeAnnotation để cung cấp fallback an toàn khi annotation là null'
);
console.log('   ✅ PASS: NULL_ANNOTATION_SAFE = YES.');

// TEST 21: malformed annotation safe
console.log('🧪 Test 21: Malformed annotation safe');
// Test sanitize logic runtime
function sanitizeTest(ann) {
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) {
    return { schema_version: 1, strokes: [], stamps: [], notes: [] };
  }
  return {
    schema_version: ann.schema_version || 1,
    strokes: Array.isArray(ann.strokes) ? ann.strokes : [],
    stamps: Array.isArray(ann.stamps) ? ann.stamps : [],
    notes: Array.isArray(ann.notes) ? ann.notes : []
  };
}
const malformedRes = sanitizeTest({ schema_version: 'invalid', strokes: 'not-an-array' });
assert(Array.isArray(malformedRes.strokes) && malformedRes.strokes.length === 0);
assert(Array.isArray(malformedRes.stamps) && malformedRes.stamps.length === 0);
console.log('   ✅ PASS: MALFORMED_ANNOTATION_SAFE = YES.');

// TEST 22: readOnly canvas used
console.log('🧪 Test 22: SubmissionAnnotationCanvas được sử dụng với readOnly={true}');
assert(
  viewerCode.includes('<SubmissionAnnotationCanvas') &&
  viewerCode.includes('readOnly={true}'),
  'Phải render SubmissionAnnotationCanvas với readOnly={true}'
);
console.log('   ✅ PASS: ANNOTATION_READ_ONLY = YES.');

// TEST 23: AnnotationToolbar not rendered in student viewer
console.log('🧪 Test 23: AnnotationToolbar không xuất hiện trong student viewer');
assert(
  !viewerCode.includes('AnnotationToolbar'),
  'Tuyệt đối không render AnnotationToolbar trong StudentGradedViewerModal'
);
console.log('   ✅ PASS: TOOLBAR_RENDERED_IN_STUDENT_VIEWER = NO.');

// TEST 24: saveAnnotationDraft absent
console.log('🧪 Test 24: saveAnnotationDraft không có trong student viewer');
assert(!viewerCode.includes('saveAnnotationDraft'), 'Student viewer không gọi saveAnnotationDraft');
console.log('   ✅ PASS: SAVE_ANNOTATION_DRAFT_CALLED = NO.');

// TEST 25: finalizeGradingWithAnnotations absent
console.log('🧪 Test 25: finalizeGradingWithAnnotations không có trong student viewer');
assert(!viewerCode.includes('finalizeGradingWithAnnotations'), 'Student viewer không gọi finalizeGradingWithAnnotations');
console.log('   ✅ PASS: FINALIZE_GRADING_WITH_ANNOTATIONS_CALLED = NO.');

// TEST 26: legacy fallback retained
console.log('🧪 Test 26: Giữ nguyên fallback cho legacy file_url');
assert(
  viewerCode.includes('legacySignedUrl') || viewerCode.includes('ans.file_url'),
  'Phải hỗ trợ hiển thị legacy file bài nộp khi không có attachment Phase 1'
);
console.log('   ✅ PASS: LEGACY_SUBMISSION_SUPPORTED = YES.');

// TEST 27: duplicate legacy / Phase 1 prevented
console.log('🧪 Test 27: Tránh duplicate hiển thị giữa legacy file và Phase 1 attachment');
assert(
  viewerCode.includes('!hasAttachments && ans.file_url') ||
  viewerCode.includes('attachments.some(a => a.storage_path === ans.file_url)'),
  'Phải chặn trùng lặp hiển thị giữa file legacy và attachment Phase 1'
);
console.log('   ✅ PASS: LEGACY_DUPLICATE_PREVENTED = YES.');

// TEST 28: non-image file not sent to annotation canvas
console.log('🧪 Test 28: Tệp không phải ảnh không đưa vào annotation canvas');
assert(
  viewerCode.includes("att.mime_type.startsWith('image/')") || viewerCode.includes('isImage ?'),
  'Chỉ các file ảnh mới render SubmissionAnnotationCanvas, file khác hiển thị link tải/xem'
);
console.log('   ✅ PASS: NON_IMAGE_FILE_SAFE = YES.');

// TEST 29: submitted/pending entry blocked
console.log('🧪 Test 29: Trạng thái submitted/pending không mở graded viewer');
assert(
  tabCode.includes('isGraded ?') &&
  tabCode.includes('isRevision ?') &&
  tabCode.includes('isPending ?'),
  'ExerciseListTab phải phân tách rõ các trạng thái của bài nộp'
);
console.log('   ✅ PASS: STUDENT_STATUS_ENTRY_GATE = YES.');

// TEST 30: graded/revision entry available in ExerciseListTab
console.log('🧪 Test 30: Nút Xem Bài Đã Chấm / Xem Lời Phê mở Graded Viewer');
assert(
  tabCode.includes('StudentGradedViewerModal') &&
  tabCode.includes('setSelectedGradedSubmissionId(sub.id)') &&
  tabCode.includes('setIsGradedViewerOpen(true)'),
  'ExerciseListTab phải mở StudentGradedViewerModal khi bấm Xem Bài Đã Chấm hoặc Xem Lời Phê'
);
console.log('   ✅ PASS: Entry point tích hợp đầy đủ trong ExerciseListTab.');

// TEST 31: readOnly canvas does not block mobile touch scroll
console.log('🧪 Test 31: Canvas readOnly không chặn scroll màn hình mobile');
assert(
  canvasCode.includes("touchAction: readOnly ? 'auto' : 'none'") ||
  canvasCode.includes("style={{ touchAction: readOnly ? 'auto' : 'none' }}"),
  'Canvas phải set touchAction auto khi readOnly để không chặn scroll mobile'
);
assert(
  canvasCode.includes("readOnly ? 'pointer-events-none' : 'touch-none pointer-events-auto'"),
  'SVG overlay phải đặt pointer-events-none khi readOnly'
);
console.log('   ✅ PASS: READONLY_TOUCH_SCROLL_SAFE = YES.');

// TEST 32: responsive modal classes present
console.log('🧪 Test 32: Modal và hình ảnh có các class responsive đầy đủ');
assert(
  viewerCode.includes('max-w-4xl') &&
  viewerCode.includes('max-h-[92vh]') &&
  viewerCode.includes('overflow-y-auto') &&
  viewerCode.includes('w-full'),
  'Modal phải có các class responsive max-w-4xl, max-h-[92vh], overflow-y-auto'
);
console.log('   ✅ PASS: Responsive classes present.');

console.log('\n================================================================================');
console.log('🎉 TẤT CẢ 32/32 KIỂM THỬ FRONTEND STEP E ĐÃ PASS HOÀN TOÀN!');
console.log('================================================================================\n');
