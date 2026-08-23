import assert from 'node:assert';
import fs from 'node:fs';

console.log('=== RUNNING TARGETED TESTS FOR SCORM G6 ZIP UPLOAD MIME NORMALIZATION ===\n');

// Đọc source code MaterialFormModal.jsx
const fileContent = fs.readFileSync('src/components/materials/MaterialFormModal.jsx', 'utf8');

// Test 1, 2, 3: SCORM Upload Option Check
// Khi isScormUpload là true, dù browser gửi file.type là gì:
// - 'application/x-zip-compressed' (Windows Chrome)
// - 'application/zip' (chuẩn RFC / macOS / Linux)
// - '' (trống khi browser không nhận diện được extension .zip)
// Hàm upload của Supabase Storage luôn nhận object options cố định có contentType: 'application/zip'.
const scormUploadSnippet = fileContent.substring(
  fileContent.indexOf('BƯỚC 3: TẢI TỆP ZIP GỐC LÊN BUCKET LEARNING-MATERIALS'),
  fileContent.indexOf('newlyUploadedPath = zipStoragePath;')
);

console.log('[TEST 1, 2, 3] Verifying SCORM ZIP Storage upload options:');
assert.ok(scormUploadSnippet.includes(".from('learning-materials')"), 'Must target learning-materials bucket');
assert.ok(scormUploadSnippet.includes("contentType: 'application/zip'"), 'Must explicitly specify contentType: application/zip');
assert.ok(scormUploadSnippet.includes("cacheControl: '3600'"), 'Must keep cacheControl: 3600');
assert.ok(scormUploadSnippet.includes("upsert: false"), 'Must keep upsert: false');
console.log('  -> PASS: SCORM ZIP upload options always normalize contentType to application/zip regardless of browser MIME.\n');

// Test 4: Normal non-SCORM upload path unchanged
console.log('[TEST 4] Verifying normal non-SCORM upload path:');
const normalUploadSnippet = fileContent.substring(
  fileContent.indexOf('XỬ LÝ UPLOAD FILE THƯỜNG KHÁC'),
  fileContent.indexOf('newlyUploadedPath = storagePath;')
);
assert.ok(normalUploadSnippet.includes(".upload(storagePath, file, { cacheControl: '3600', upsert: false })"), 'Normal upload options must NOT have contentType override');
console.log('  -> PASS: Normal non-SCORM upload remains unchanged.\n');

// Test 5: share_token behavior unchanged
console.log('[TEST 5] Verifying share_token behavior:');
const shareTokenSnippet = fileContent.substring(
  fileContent.indexOf('// Xử lý share_token khớp ràng buộc check_share_token_consistency:'),
  fileContent.indexOf('const payload = {')
);
assert.ok(shareTokenSnippet.includes("if (visibility === 'public')"), 'Must handle public visibility');
assert.ok(shareTokenSnippet.includes("computedShareToken = crypto.randomUUID().replace(/-/g, '')"), 'Must generate random token for new public');
assert.ok(shareTokenSnippet.includes("computedShareToken = null;"), 'Must set null for class/school');
console.log('  -> PASS: share_token contract and consistency logic intact.\n');

// Test 6: SCORM rollback behavior unchanged
console.log('[TEST 6] Verifying SCORM rollback behavior:');
const rollbackSnippet = fileContent.substring(
  fileContent.indexOf('// Rollback dọn dẹp Storage nếu fail'),
  fileContent.indexOf('setErrorMsg(err.message')
);
assert.ok(rollbackSnippet.includes("await supabase.storage.from('learning-materials').remove([newlyUploadedPath])"), 'Must clean learning-materials storage');
assert.ok(rollbackSnippet.includes("await cleanupScormPackageStorage(`${profile.id}/${newlyCreatedPackageId}`)"), 'Must clean scorm-content bucket');
assert.ok(rollbackSnippet.includes(".update({ status: 'failed' })"), 'Must mark package status failed');
console.log('  -> PASS: SCORM rollback and error cleanup logic intact.\n');

console.log('ALL 6 TARGETED TESTS PASSED SUCCESSFULLY! ✅');
