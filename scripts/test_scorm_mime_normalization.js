import assert from 'node:assert';
import fs from 'node:fs';

console.log('=== RUNNING TARGETED TESTS FOR SCORM G6 ZIP MIME BODY NORMALIZATION ===\n');

// 1. Kiểm tra File/Blob normalization logic với bytes thực tế
console.log('[TEST 1, 2, 3, 6] Simulating browser File/Blob slice normalization:');

const sampleZipBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]); // PK header
const originalFileMeta = { name: 'lesson_math_grade1.zip', size: sampleZipBytes.length };

const testCases = [
  { desc: 'Windows Chrome MIME', mime: 'application/x-zip-compressed' },
  { desc: 'Standard MIME', mime: 'application/zip' },
  { desc: 'Empty MIME (undetected by OS)', mime: '' }
];

for (const tc of testCases) {
  const originalBlob = new Blob([sampleZipBytes], { type: tc.mime });
  assert.strictEqual(originalBlob.type, tc.mime, `Original mime should be ${tc.mime}`);

  // Áp dụng kỹ thuật: file.slice(0, file.size, 'application/zip')
  const normalizedBlob = originalBlob.slice(0, originalBlob.size, 'application/zip');

  // Verify:
  assert.strictEqual(normalizedBlob.type, 'application/zip', `${tc.desc}: normalized type must be application/zip`);
  assert.strictEqual(normalizedBlob.size, originalBlob.size, `${tc.desc}: size must match exactly`);
  
  // Verify byte content preservation
  const normBuffer = Buffer.from(await normalizedBlob.arrayBuffer());
  assert.strictEqual(normBuffer.length, sampleZipBytes.length, `${tc.desc}: byte length must match`);
  assert.deepStrictEqual(normBuffer, sampleZipBytes, `${tc.desc}: binary contents must be 100% identical`);
  
  console.log(`  -> PASS [${tc.desc}]: '${tc.mime || "(empty)"}' -> '${normalizedBlob.type}' (Bytes: ${normBuffer.length} bytes preserved)`);
}

// 2. Kiểm tra Source Code Modal
console.log('\n[TEST 4, 5, 7, 8, 9] Verifying MaterialFormModal.jsx implementation:');
const fileContent = fs.readFileSync('src/components/materials/MaterialFormModal.jsx', 'utf8');

// Test SCORM upload body & options
const scormUploadSection = fileContent.substring(
  fileContent.indexOf('BƯỚC 3: TẢI TỆP ZIP GỐC LÊN BUCKET LEARNING-MATERIALS'),
  fileContent.indexOf('newlyUploadedPath = zipStoragePath;')
);

assert.ok(
  scormUploadSection.includes("const normalizedZipBlob = file.slice(0, file.size, 'application/zip');"),
  'Must create normalizedZipBlob via file.slice(0, file.size, "application/zip")'
);
assert.ok(
  scormUploadSection.includes(".upload(zipStoragePath, normalizedZipBlob, { contentType: 'application/zip', cacheControl: '3600', upsert: false })"),
  'Must upload normalizedZipBlob and keep contentType option defense-in-depth'
);
console.log('  -> PASS: SCORM upload body is normalizedZipBlob with contentType option preserved.');

// Test payload preserves original file.name and file.size
const payloadSection = fileContent.substring(
  fileContent.indexOf('const payload = {'),
  fileContent.indexOf('let savedMaterialId = materialToEdit?.id;')
);
assert.ok(payloadSection.includes("file_name: sourceType === 'file' ? (file ? file.name : finalFileName) : null"), 'DB payload must preserve original file.name');
assert.ok(payloadSection.includes("file_size: sourceType === 'file' ? (file ? file.size : finalFileSize) : 0"), 'DB payload must preserve original file.size');
console.log('  -> PASS: DB metadata preserves original file.name and file.size.');

// Test Normal non-SCORM upload path unchanged
const normalUploadSection = fileContent.substring(
  fileContent.indexOf('XỬ LÝ UPLOAD FILE THƯỜNG KHÁC'),
  fileContent.indexOf('newlyUploadedPath = storagePath;')
);
assert.ok(
  normalUploadSection.includes(".upload(storagePath, file, { cacheControl: '3600', upsert: false })"),
  'Normal non-SCORM upload must remain unchanged with raw file and standard options'
);
console.log('  -> PASS: Normal non-SCORM upload path is completely untouched.');

// Test share_token logic intact
const shareTokenSection = fileContent.substring(
  fileContent.indexOf('// Xử lý share_token khớp ràng buộc check_share_token_consistency:'),
  fileContent.indexOf('const payload = {')
);
assert.ok(shareTokenSection.includes("if (visibility === 'public')"), 'Public visibility logic intact');
assert.ok(shareTokenSection.includes("computedShareToken = crypto.randomUUID().replace(/-/g, '')"), 'Token generation intact');
assert.ok(shareTokenSection.includes("computedShareToken = null;"), 'Class/school null token intact');
console.log('  -> PASS: share_token contract logic is intact.');

// Test rollback logic intact
const rollbackSection = fileContent.substring(
  fileContent.indexOf('// Rollback dọn dẹp Storage nếu fail'),
  fileContent.indexOf('setErrorMsg(err.message')
);
assert.ok(rollbackSection.includes("await supabase.storage.from('learning-materials').remove([newlyUploadedPath])"), 'Storage rollback intact');
assert.ok(rollbackSection.includes("await cleanupScormPackageStorage(`${profile.id}/${newlyCreatedPackageId}`)"), 'SCORM package cleanup intact');
assert.ok(rollbackSection.includes(".update({ status: 'failed' })"), 'Status failed update intact');
console.log('  -> PASS: Rollback and error recovery logic is intact.\n');

console.log('ALL TARGETED TESTS PASSED SUCCESSFULLY! ✅');
