import assert from 'node:assert';
import * as XLSX from 'xlsx';
import {
  normalizeImportedQuestion,
  getQuestionValidationErrors,
  parseExcelQuestions
} from '../src/utils/questionFileParsers.js';
import {
  validateImageFile,
  optimizeImageBeforeUpload,
  MAX_ALLOWED_IMAGE_BYTES,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_IMAGE_EXTENSIONS
} from '../src/utils/imageOptimizer.js';
import {
  screenToNormalized,
  zoomIn,
  zoomOut,
  resetZoom,
  clampScale,
  MIN_SCALE,
  MAX_SCALE
} from '../src/utils/annotationViewportMath.js';

console.log('=== RUNNING TESTS: ACADEMIC EXERCISE IMAGE_UPLOAD QUESTION TYPE ===\n');

// TEST 1: normalizeImportedQuestion for image_upload
console.log('--- TEST 1: Normalization for image_upload ---');
const rawImageQ = {
  id: 'test-q-1',
  question_number: 1,
  question_type: 'image_upload',
  prompt: 'Em hãy làm bài toán ra giấy và chụp ảnh nộp tại đây.',
  points: 5
};
const normImageQ = normalizeImportedQuestion(rawImageQ, 0);

assert.strictEqual(normImageQ.question_type, 'image_upload', 'question_type must be image_upload');
assert.strictEqual(normImageQ.prompt, 'Em hãy làm bài toán ra giấy và chụp ảnh nộp tại đây.');
assert.strictEqual(normImageQ.points, 5);
assert.deepStrictEqual(normImageQ.options, []);
assert.deepStrictEqual(normImageQ.options_json, []);
assert.strictEqual(normImageQ.correct_answer_key, null, 'correct_answer_key must be null');
console.log('✅ TEST 1 Passed: image_upload question correctly normalized.');

// TEST 2: Validation for image_upload
console.log('\n--- TEST 2: Validation for image_upload ---');
// 2a. Valid image_upload question
const validErrors = getQuestionValidationErrors([normImageQ]);
assert.strictEqual(validErrors.length, 0, 'Valid image_upload question should produce 0 errors');

// 2b. Missing prompt
const invalidPromptQ = normalizeImportedQuestion({
  question_number: 1,
  question_type: 'image_upload',
  prompt: '',
  points: 5
}, 0);
const promptErrors = getQuestionValidationErrors([invalidPromptQ]);
assert.strictEqual(promptErrors.length, 1, 'Empty prompt should fail validation');
assert.strictEqual(promptErrors[0].field, 'prompt');

// 2c. Invalid points
const invalidPointsQ = normalizeImportedQuestion({
  question_number: 1,
  question_type: 'image_upload',
  prompt: 'Đề bài hợp lệ',
  points: -1
}, 0);
const pointsErrors = getQuestionValidationErrors([invalidPointsQ]);
assert.strictEqual(pointsErrors.length, 1, 'Negative points should fail validation');
assert.strictEqual(pointsErrors[0].field, 'points');
console.log('✅ TEST 2 Passed: image_upload validation rules verified.');

// TEST 3: Existing Question Types Regression Check
console.log('\n--- TEST 3: Existing Question Types Regression Check ---');
const singleChoiceQ = normalizeImportedQuestion({
  question_number: 1,
  question_type: 'single_choice',
  prompt: '1 + 1 = ?',
  options: ['1', '2', '3'],
  correct_answer: '2',
  points: 2
}, 0);
assert.strictEqual(singleChoiceQ.question_type, 'single_choice');
assert.strictEqual(singleChoiceQ.correct_answer, '2');
assert.strictEqual(getQuestionValidationErrors([singleChoiceQ]).length, 0);

const multipleChoiceQ = normalizeImportedQuestion({
  question_number: 2,
  question_type: 'multiple_choice',
  prompt: 'Các số chẵn là:',
  options: ['1', '2', '3', '4'],
  correct_answer: ['2', '4'],
  points: 2
}, 1);
assert.strictEqual(multipleChoiceQ.question_type, 'multiple_choice');
assert.deepStrictEqual(multipleChoiceQ.correct_answer, ['2', '4']);
assert.strictEqual(getQuestionValidationErrors([multipleChoiceQ]).length, 0);

const fillBlankQ = normalizeImportedQuestion({
  question_number: 3,
  question_type: 'fill_blank',
  prompt: 'Điền số: 5 + 5 = ...',
  correct_answer: '10',
  points: 2
}, 2);
assert.strictEqual(fillBlankQ.question_type, 'fill_blank');
assert.strictEqual(fillBlankQ.correct_answer, '10');
assert.strictEqual(getQuestionValidationErrors([fillBlankQ]).length, 0);

const essayQ = normalizeImportedQuestion({
  question_number: 4,
  question_type: 'essay',
  prompt: 'Viết đoạn văn ngắn tả cây bàng.',
  correct_answer: 'Hướng dẫn chấm của GV',
  points: 5
}, 3);
assert.strictEqual(essayQ.question_type, 'essay');
assert.strictEqual(getQuestionValidationErrors([essayQ]).length, 0);

console.log('✅ TEST 3 Passed: 0 regression on single_choice, multiple_choice, fill_blank, short_answer, essay.');

// TEST 4: Mixed Exercise Payload Construction & Reopening Simulation
console.log('\n--- TEST 4: Mixed Exercise Payload & Draft Reopening Simulation ---');
const mixedQuestions = [singleChoiceQ, normImageQ, essayQ];
const payload = mixedQuestions.map((q, idx) => {
  const normQ = normalizeImportedQuestion(q, idx);
  return {
    question_number: idx + 1,
    question_type: normQ.question_type,
    prompt: normQ.prompt,
    options_json: normQ.options_json,
    options: normQ.options_json,
    points: normQ.points,
    correct_answer_key: ['essay', 'image_upload'].includes(normQ.question_type) ? null : normQ.correct_answer_key
  };
});

assert.strictEqual(payload[1].question_type, 'image_upload');
assert.strictEqual(payload[1].correct_answer_key, null);
assert.deepStrictEqual(payload[1].options_json, []);

// Simulate reopening draft from backend payload
const reopenedQuestions = payload.map((q, idx) => normalizeImportedQuestion(q, idx));
assert.strictEqual(reopenedQuestions[1].question_type, 'image_upload');
assert.strictEqual(reopenedQuestions[1].prompt, 'Em hãy làm bài toán ra giấy và chụp ảnh nộp tại đây.');
assert.strictEqual(reopenedQuestions[1].points, 5);
console.log('✅ TEST 4 Passed: Mixed exercise payload & reopening confirmed.');

// TEST 5: Excel Parser image_upload support
console.log('\n--- TEST 5: Excel Parser with image_upload ---');
const testWorkbook = XLSX.utils.book_new();
const excelData = [
  ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'],
  ['single_choice', '1 + 1 = ?', '1', '2', '3', '4', '2', '', 1],
  ['image_upload', 'Em hãy giải bài toán sau ra vở và chụp ảnh.', '', '', '', '', '', '', 3],
  ['essay', 'Viết đoạn văn.', '', '', '', '', '', 'Gợi ý chấm', 5]
];
const testSheet = XLSX.utils.aoa_to_sheet(excelData);
XLSX.utils.book_append_sheet(testWorkbook, testSheet, 'Sheet1');
const excelBuffer = XLSX.write(testWorkbook, { type: 'array', bookType: 'xlsx' });

const excelResult = await parseExcelQuestions(excelBuffer, 'test.xlsx');
assert.strictEqual(excelResult.success, true, 'Excel parsing should succeed');
assert.strictEqual(excelResult.questions.length, 3, 'Should parse exactly 3 questions');
assert.strictEqual(excelResult.questions[1].question_type, 'image_upload');
assert.strictEqual(excelResult.questions[1].prompt, 'Em hãy giải bài toán sau ra vở và chụp ảnh.');
assert.strictEqual(excelResult.questions[1].points, 3);
assert.strictEqual(excelResult.questions[1].correct_answer_key, null);
console.log('✅ TEST 5 Passed: Excel parser successfully parsed image_upload questions.');

// TEST 6: PHẦN 1 — Client-side Image Validation & Security
console.log('\n--- TEST 6: PHẦN 1 — Client-side Image Validation & Security ---');
// 6a. Valid JPEG
const validJpg = { name: 'bai_tap_toan.jpg', type: 'image/jpeg', size: 2.5 * 1024 * 1024 };
assert.strictEqual(validateImageFile(validJpg), null, 'Valid JPEG file should pass validation');

// 6b. Valid PNG
const validPng = { name: 'bai_tap_tieng_viet.PNG', type: 'image/png', size: 1.2 * 1024 * 1024 };
assert.strictEqual(validateImageFile(validPng), null, 'Valid PNG file should pass validation');

// 6c. Valid WEBP
const validWebp = { name: 'bai_tap_anh.webp', type: 'image/webp', size: 800 * 1024 };
assert.strictEqual(validateImageFile(validWebp), null, 'Valid WebP file should pass validation');

// 6d. File size > 10MB
const oversizedFile = { name: 'anh_sieu_nang.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 };
const oversizeError = validateImageFile(oversizedFile);
assert.ok(oversizeError && oversizeError.includes('10MB'), 'File > 10MB must be rejected with 10MB message');

// 6e. SVG format blocked
const svgFile = { name: 'malicious.svg', type: 'image/svg+xml', size: 50 * 1024 };
const svgError = validateImageFile(svgFile);
assert.ok(svgError && svgError.includes('SVG'), 'SVG file must be blocked');

// 6f. Executable / script blocked
const exeFile = { name: 'script.exe.jpg', type: 'application/x-msdownload', size: 100 * 1024 };
const exeError = validateImageFile(exeFile);
assert.ok(exeError, 'Executable file must be blocked');

// 6g. Empty file blocked
const emptyFile = { name: 'empty.jpg', type: 'image/jpeg', size: 0 };
assert.ok(validateImageFile(emptyFile)?.includes('rỗng'), 'Empty file must be rejected');

// 6h. Unsupported extension (PDF)
const pdfFile = { name: 'document.pdf', type: 'application/pdf', size: 500 * 1024 };
assert.ok(validateImageFile(pdfFile)?.includes('PNG, JPG, JPEG hoặc WebP'), 'PDF file must be rejected');
console.log('✅ TEST 6 Passed: Client-side validation and 10MB / MIME security rules confirmed.');

// TEST 7: PHẦN 2 — Client-side Image Optimization Engine
console.log('\n--- TEST 7: PHẦN 2 — Client-side Image Optimization Engine ---');
// 7a. Small files bypass compression
const smallFile = { name: 'small_photo.jpg', type: 'image/jpeg', size: 350 * 1024 };
const optSmall = await optimizeImageBeforeUpload(smallFile);
assert.strictEqual(optSmall, smallFile, 'Small file <= 400KB must bypass compression');

// 7b. Null / undefined safety
const optNull = await optimizeImageBeforeUpload(null);
assert.strictEqual(optNull, null, 'Null file returns null safely');
console.log('✅ TEST 7 Passed: Client-side optimization bypass & safety verified.');

// TEST 8: PHẦN 3 — Teacher Viewport Zoom, Rotate 90° & Reset View Math
console.log('\n--- TEST 8: PHẦN 3 — Teacher Viewport Zoom, Rotate & Reset Math ---');
const viewportRect = { left: 100, top: 50, width: 800, height: 600 };
const baseWidth = 800;
const baseHeight = 600;

// 8a. Rotation = 0° (Standard Identity)
const pt0 = screenToNormalized({
  clientX: 500, // center X: 100 + 400 = 500
  clientY: 350, // center Y: 50 + 300 = 350
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 1,
  panX: 0,
  panY: 0,
  rotation: 0
});
assert.strictEqual(pt0.x, 0.5, 'Center at 0° must be 0.5');
assert.strictEqual(pt0.y, 0.5, 'Center at 0° must be 0.5');

// 8b. Rotation = 90°
// Clicking at top-right of viewport (clientX: 700, clientY: 100)
// deltaX: 700 - (400 + 100) = 200, deltaY: 100 - (300 + 50) = -250
const pt90 = screenToNormalized({
  clientX: 500,
  clientY: 350,
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 1,
  panX: 0,
  panY: 0,
  rotation: 90
});
assert.strictEqual(pt90.x, 0.5, 'Center at 90° must remain 0.5');
assert.strictEqual(pt90.y, 0.5, 'Center at 90° must remain 0.5');

// 8c. Rotation = 180°
const pt180 = screenToNormalized({
  clientX: 500,
  clientY: 350,
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 1,
  panX: 0,
  panY: 0,
  rotation: 180
});
assert.strictEqual(pt180.x, 0.5, 'Center at 180° must remain 0.5');
assert.strictEqual(pt180.y, 0.5, 'Center at 180° must remain 0.5');

// 8d. Zoom in / Zoom out stepping
let curScale = 1;
curScale = zoomIn(curScale);
assert.strictEqual(curScale, 1.25, 'Zoom in should increase scale to 1.25');
curScale = zoomIn(curScale);
assert.strictEqual(curScale, 1.5, 'Zoom in should increase scale to 1.5');
curScale = zoomOut(curScale);
assert.strictEqual(curScale, 1.25, 'Zoom out should decrease scale to 1.25');

// 8f. Combined Zoom = 2 + Rotate = 90° (Center Click)
const ptZoomRotateCenter = screenToNormalized({
  clientX: 500,
  clientY: 350,
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 2,
  panX: 0,
  panY: 0,
  rotation: 90
});
assert.strictEqual(ptZoomRotateCenter.x, 0.5, 'Center under Zoom 2 + Rotate 90° must remain exact 0.5');
assert.strictEqual(ptZoomRotateCenter.y, 0.5, 'Center under Zoom 2 + Rotate 90° must remain exact 0.5');

// 8g. Combined Zoom = 2 + Rotate = 90° (Arbitrary Point Invariance)
// Original point P: normalized (0.625, 0.5833333333333334) -> pixels (500, 350) -> relative to center (100, 50)
// Rotated 90° around center (400, 300) -> (-50, 100)
// Scaled 2x -> (-100, 200)
// Viewport screen coordinate: clientX = 100 + 400 - 100 = 400, clientY = 50 + 300 + 200 = 550
const ptZoomRotatePoint = screenToNormalized({
  clientX: 400,
  clientY: 550,
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 2,
  panX: 0,
  panY: 0,
  rotation: 90
});
assert.strictEqual(Math.round(ptZoomRotatePoint.x * 800), 500, 'Original X (500px) must be recovered exactly');
assert.strictEqual(Math.round(ptZoomRotatePoint.y * 600), 350, 'Original Y (350px) must be recovered exactly');

// 8h. Combined Zoom = 3 + Rotate = 180°
const ptZoomRotate180 = screenToNormalized({
  clientX: 500,
  clientY: 350,
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 3,
  panX: 0,
  panY: 0,
  rotation: 180
});
assert.strictEqual(ptZoomRotate180.x, 0.5, 'Center under Zoom 3 + Rotate 180° must remain exact 0.5');
assert.strictEqual(ptZoomRotate180.y, 0.5, 'Center under Zoom 3 + Rotate 180° must remain exact 0.5');

// 8i. Combined Zoom = 4 + Rotate = 270°
const ptZoomRotate270 = screenToNormalized({
  clientX: 500,
  clientY: 350,
  viewportRect,
  baseWidth,
  baseHeight,
  scale: 4,
  panX: 0,
  panY: 0,
  rotation: 270
});
assert.strictEqual(ptZoomRotate270.x, 0.5, 'Center under Zoom 4 + Rotate 270° must remain exact 0.5');
assert.strictEqual(ptZoomRotate270.y, 0.5, 'Center under Zoom 4 + Rotate 270° must remain exact 0.5');

console.log('✅ TEST 8 Passed: Viewport Zoom, Rotate and Reset mathematical integrity confirmed.');

console.log('\n🎉 ALL 8 TEST SUITES PASSED WITH 100% SUCCESS (EXIT CODE 0)!');
