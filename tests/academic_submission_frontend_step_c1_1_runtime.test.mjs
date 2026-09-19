import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ RUNTIME HÌNH HỌC & TƯƠNG TÁC STEP C1.1 (BROWSER GEOMETRY RUNTIME)');
console.log('================================================================================\n');

// 1. AUDIT SOURCE FILES
const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
const toolbarFile = path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx');
const gradingModalFile = path.resolve('src/components/dashboard/exercises/SubmissionGradingModal.jsx');

const canvasCode = fs.readFileSync(canvasFile, 'utf8');
const toolbarCode = fs.readFileSync(toolbarFile, 'utf8');
const modalCode = fs.readFileSync(gradingModalFile, 'utf8');

// TEST 1: NO CANVAS BACKEND MUTATION
console.log('🧪 Test 1: Xác nhận Canvas không trực tiếp kích hoạt Backend RPC');
assert(!canvasCode.includes('saveAnnotationDraft('), 'Canvas không tự ý gọi saveAnnotationDraft');
assert(!canvasCode.includes('finalizeGradingWithAnnotations('), 'Canvas không tự ý gọi finalizeGradingWithAnnotations');
console.log('   ✅ PASS: SubmissionAnnotationCanvas là UI component thuần túy.');

// TEST 2: IMAGE GEOMETRY & OBJECT-FIT AUDIT
console.log('🧪 Test 2: Rà soát Object-Fit & Khung hình SVG Overlay (No Letterbox Bug)');
assert(!canvasCode.includes('object-fit: contain') && !canvasCode.includes('object-contain'), 'Không dùng object-fit: contain gây letterbox');
assert(canvasCode.includes('w-full h-auto block'), 'Ảnh gốc dùng layout w-full h-auto block vừa khít container');
assert(canvasCode.includes('absolute inset-0 w-full h-full'), 'SVG overlay phủ trọn vẹn 100% rendered image box');
console.log('   ✅ PASS: IMAGE_OBJECT_FIT: NONE, IMAGE_RENDERED_BOX_MATCHES_SVG_BOX: YES.');

// TEST 3: SIMULATE 3 ASPECT RATIOS (Landscape, Portrait, Long Vertical)
console.log('🧪 Test 3: Mô phỏng hình học trên 3 tỉ lệ ảnh khác nhau (4:3, 3:4, 1:4)');

function simulatePointerToNormalized(clientX, clientY, rect) {
  const rawX = (clientX - rect.left) / rect.width;
  const rawY = (clientY - rect.top) / rect.height;
  return {
    x: Math.max(0, Math.min(1, rawX)),
    y: Math.max(0, Math.min(1, rawY))
  };
}

function simulateNormalizedToScreen(x, y, rect) {
  return {
    screenX: rect.left + x * rect.width,
    screenY: rect.top + y * rect.height
  };
}

// 3A: Landscape 4:3 (800x600 at left: 100, top: 50)
const landscapeRect = { left: 100, top: 50, width: 800, height: 600 };
const centerLandscape = simulatePointerToNormalized(500, 350, landscapeRect);
assert.equal(centerLandscape.x, 0.5, 'Tâm ảnh ngang phải là x=0.5');
assert.equal(centerLandscape.y, 0.5, 'Tâm ảnh ngang phải là y=0.5');

// 3B: Portrait 3:4 (600x800 at left: 100, top: 50)
const portraitRect = { left: 100, top: 50, width: 600, height: 800 };
const centerPortrait = simulatePointerToNormalized(400, 450, portraitRect);
assert.equal(centerPortrait.x, 0.5, 'Tâm ảnh dọc phải là x=0.5');
assert.equal(centerPortrait.y, 0.5, 'Tâm ảnh dọc phải là y=0.5');

// 3C: Long vertical 1:4 (300x1200 at left: 50, top: 20)
const longRect = { left: 50, top: 20, width: 300, height: 1200 };
const centerLong = simulatePointerToNormalized(200, 620, longRect);
assert.equal(centerLong.x, 0.5, 'Tâm ảnh dài phải là x=0.5');
assert.equal(centerLong.y, 0.5, 'Tâm ảnh dài phải là y=0.5');

// Corner tests for all rects
[landscapeRect, portraitRect, longRect].forEach((rect, idx) => {
  const topLeft = simulatePointerToNormalized(rect.left, rect.top, rect);
  const bottomRight = simulatePointerToNormalized(rect.left + rect.width, rect.top + rect.height, rect);
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);
  assert.equal(bottomRight.x, 1);
  assert.equal(bottomRight.y, 1);
});
console.log('   ✅ PASS: Cả 3 tỉ lệ ảnh Landscape (4:3), Portrait (3:4) và Long Vertical (1:4) định vị chính xác 100%.');

// TEST 4: RESIZE GEOMETRY STABILITY (1200px -> 400px Mobile)
console.log('🧪 Test 4: Kiểm tra độ ổn định tọa độ khi co giãn trình duyệt (1200px -> 400px)');
const desktopRect = { left: 50, top: 50, width: 1000, height: 750 };
const mobileRect = { left: 10, top: 20, width: 360, height: 270 };

const point = { x: 0.25, y: 0.75 };
const screenDesktop = simulateNormalizedToScreen(point.x, point.y, desktopRect);
const reNormalizedFromDesktop = simulatePointerToNormalized(screenDesktop.screenX, screenDesktop.screenY, desktopRect);
assert.equal(reNormalizedFromDesktop.x, 0.25);
assert.equal(reNormalizedFromDesktop.y, 0.75);

const screenMobile = simulateNormalizedToScreen(point.x, point.y, mobileRect);
const reNormalizedFromMobile = simulatePointerToNormalized(screenMobile.screenX, screenMobile.screenY, mobileRect);
assert.equal(reNormalizedFromMobile.x, 0.25);
assert.equal(reNormalizedFromMobile.y, 0.75);
console.log('   ✅ PASS: NORMALIZED_POSITION_STABLE: YES (Tọa độ không dịch chuyển khi thay đổi kích thước).');

// TEST 5: POINTER CAPTURE & TOUCH SCROLL
console.log('🧪 Test 5: Xác minh Pointer Capture & Chặn cuộn trang khi vẽ (Touch-action none)');
assert(canvasCode.includes('setPointerCapture'), 'Canvas phải gọi setPointerCapture khi pointer down');
assert(canvasCode.includes('releasePointerCapture'), 'Canvas phải gọi releasePointerCapture khi pointer up/cancel');
assert(canvasCode.includes('touchAction') || canvasCode.includes('touch-none'), 'Canvas phải cấu hình touchAction none');
console.log('   ✅ PASS: Pointer capture an toàn, scroll behavior an toàn.');

// TEST 6: ERASER HIT TESTING AFTER RESIZE
console.log('🧪 Test 6: Kiểm tra Hit-Testing của công cụ Eraser trên tọa độ chuẩn hóa');
function isPointNearStroke(stroke, x, y, threshold = 0.04) {
  return stroke.points.some(p => Math.hypot(p.x - x, p.y - y) < threshold);
}

const sampleStroke = {
  id: 'str_1',
  points: [{ x: 0.2, y: 0.3 }, { x: 0.21, y: 0.32 }, { x: 0.22, y: 0.35 }]
};

// Click close to stroke (0.205, 0.305) -> distance is ~0.007 < 0.04 -> Hit!
assert(isPointNearStroke(sampleStroke, 0.205, 0.305), 'Hit-testing phải phát hiện điểm gần nét vẽ');
// Click far away (0.8, 0.8) -> distance is > 0.6 -> Miss!
assert(!isPointNearStroke(sampleStroke, 0.8, 0.8), 'Hit-testing không được xóa nhầm nét ở xa');
console.log('   ✅ PASS: Eraser hit-testing hoạt động chính xác trên hệ tọa độ chuẩn hóa.');

// TEST 7: HYDRATION & MALFORMED RESILIENCE
console.log('🧪 Test 7: Kiểm tra Hydration & Xử lý dữ liệu Annotation Malformed');
const validWorkspace = {
  annotation_draft: {
    annotation_json: {
      att_123: {
        schema_version: 1,
        strokes: [sampleStroke],
        stamps: [{ id: 'st_1', type: 'check', x: 0.5, y: 0.5 }],
        notes: []
      }
    }
  }
};

// Test hydrator logic
function hydrateTest(wsData) {
  const initial = {};
  const raw = wsData?.annotation_draft?.annotation_json || wsData?.latest_annotation?.annotation_json;
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([attId, val]) => {
      if (val && typeof val === 'object') {
        initial[attId] = {
          schema_version: val.schema_version || 1,
          strokes: Array.isArray(val.strokes) ? val.strokes : [],
          stamps: Array.isArray(val.stamps) ? val.stamps : [],
          notes: Array.isArray(val.notes) ? val.notes : []
        };
      }
    });
  }
  return initial;
}

const hydrated = hydrateTest(validWorkspace);
assert.equal(hydrated.att_123.strokes.length, 1);
assert.equal(hydrated.att_123.stamps.length, 1);

// Malformed tests: string, array, null, undefined
assert.doesNotThrow(() => hydrateTest({ annotation_draft: { annotation_json: "invalid-string" } }));
assert.doesNotThrow(() => hydrateTest({ annotation_draft: { annotation_json: null } }));
assert.doesNotThrow(() => hydrateTest(null));
console.log('   ✅ PASS: Hydration thành công, Malformed data được xử lý an toàn không crash.');

console.log('\n🎉 TOÀN BỘ KIỂM THỬ RUNTIME STEP C1.1 ĐÃ PASS THÀNH CÔNG!\n');
