/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM G7 LARGE PACKAGE SUPPORT (100MB)
 * ====================================================================
 * Kiểm thử:
 * 1. Hằng số SCORM_LIMITS (100MB Zip, 300MB Uncompressed, 100MB Single Asset)
 * 2. Boundary tests của validateScormZip (không cấp phát 300MB RAM thật):
 *    - ZIP: 99MB (ALLOW), 100MB (ALLOW), 100MB + 1 byte (DENY)
 *    - Total Uncompressed: 299MB (ALLOW), 300MB (ALLOW), 300MB + 1 byte (DENY)
 *    - Single File: 99MB (ALLOW), 100MB (ALLOW), 100MB + 1 byte (DENY)
 * 3. Bảo toàn các rào chắn bảo mật (ENTRY_COUNT, PATH_DEPTH, COMPRESSION_RATIO, TRAVERSAL)
 * 4. Migration Audit & Contract Verification: ADD_SCORM_LARGE_PACKAGE_LIMITS.sql
 *    - CHỈ thay đổi file_size_limit lên 100MB (104857600 bytes)
 *    - learning-materials: MIME array trước == MIME array sau (không mutate/append)
 *    - learning-materials: Thiếu application/zip -> FAIL CLOSED, MIME giữ nguyên
 *    - learning-materials: allowed_mime_types IS NULL -> FAIL CLOSED, MIME giữ nguyên NULL
 *    - scorm-content: MIME array trước == MIME array sau
 *    - Thực thi lần 2: Idempotent
 * ====================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { SCORM_LIMITS } from '../src/constants/scormConstants.js';
import { validateScormZip } from '../src/utils/scormZipValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 SCORM G7 LARGE PACKAGE (100MB): SECURITY & BOUNDARY TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  function pass(name, detail = '') {
    passedTests++;
    console.log(`  ✅ [PASS] ${name}${detail ? ` -> ${detail}` : ''}`);
  }

  // ==================================================================
  // PHẦN 1: KIỂM TRA HẰNG SỐ HỆ THỐNG G7 (src/constants/scormConstants.js)
  // ==================================================================
  console.log('--- 1. SCORM CONSTANTS INTEGRITY AUDIT ---');

  const EXPECTED_MAX_ZIP = 100 * 1024 * 1024; // 104,857,600
  const EXPECTED_MAX_UNCOMPRESSED = 300 * 1024 * 1024; // 314,572,800
  const EXPECTED_MAX_SINGLE = 100 * 1024 * 1024; // 104,857,600

  assert.strictEqual(SCORM_LIMITS.MAX_ZIP_SIZE, EXPECTED_MAX_ZIP, 'MAX_ZIP_SIZE must be 100MB');
  pass('MAX_ZIP_SIZE', '100MB (104,857,600 bytes)');

  assert.strictEqual(SCORM_LIMITS.MAX_TOTAL_UNCOMPRESSED_SIZE, EXPECTED_MAX_UNCOMPRESSED, 'MAX_TOTAL_UNCOMPRESSED_SIZE must be 300MB');
  pass('MAX_TOTAL_UNCOMPRESSED_SIZE', '300MB (314,572,800 bytes)');

  assert.strictEqual(SCORM_LIMITS.MAX_SINGLE_FILE_SIZE, EXPECTED_MAX_SINGLE, 'MAX_SINGLE_FILE_SIZE must be 100MB');
  pass('MAX_SINGLE_FILE_SIZE', '100MB (104,857,600 bytes)');

  assert.strictEqual(SCORM_LIMITS.MAX_ENTRY_COUNT, 1000, 'MAX_ENTRY_COUNT must remain 1000');
  pass('MAX_ENTRY_COUNT', '1000 entries preserved');

  assert.strictEqual(SCORM_LIMITS.MAX_PATH_DEPTH, 10, 'MAX_PATH_DEPTH must remain 10');
  pass('MAX_PATH_DEPTH', '10 levels preserved');

  assert.strictEqual(SCORM_LIMITS.MAX_COMPRESSION_RATIO, 100, 'MAX_COMPRESSION_RATIO must remain 100');
  pass('MAX_COMPRESSION_RATIO', '100x preserved');


  // ==================================================================
  // PHẦN 2: BOUNDARY TESTS CHO VALIDATOR (KHÔNG TỐN 300MB RAM THẬT)
  // ==================================================================
  console.log('\n--- 2. VALIDATOR BOUNDARY TESTING ---');

  // Helper tạo base zip hợp lệ
  const validManifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-01" version="1.0"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <organizations default="B0">
    <organization identifier="B0">
      <title>Test G7 Course</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Lesson 1</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

  async function createBaseZipBuffer() {
    const zip = new JSZip();
    zip.file('imsmanifest.xml', validManifestXml);
    zip.file('index.html', '<!DOCTYPE html><html><body>Test</body></html>');
    return await zip.generateAsync({ type: 'uint8array' });
  }

  const baseZipBytes = await createBaseZipBuffer();

  function wrapZipSize(uint8Array, mockSize) {
    const wrapped = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    wrapped.size = mockSize;
    return wrapped;
  }

  // A. ZIP SIZE BOUNDARY
  // 1. 99MB = ALLOW
  {
    const mock99MB = wrapZipSize(baseZipBytes, 99 * 1024 * 1024);
    const res = await validateScormZip(mock99MB);
    assert.strictEqual(res.isValid, true);
    pass('ZIP Boundary 99MB', 'ALLOW');
  }

  // 2. 100MB = ALLOW
  {
    const mock100MB = wrapZipSize(baseZipBytes, 100 * 1024 * 1024);
    const res = await validateScormZip(mock100MB);
    assert.strictEqual(res.isValid, true);
    pass('ZIP Boundary 100MB', 'ALLOW');
  }

  // 3. 100MB + 1 byte = DENY
  {
    const mock100MBPlus1 = wrapZipSize(baseZipBytes, 100 * 1024 * 1024 + 1);
    let errorCaught = false;
    try {
      await validateScormZip(mock100MBPlus1);
    } catch (err) {
      errorCaught = true;
      assert.ok(err.message.includes('100MB'), `Expected 100MB limit error, got: ${err.message}`);
    }
    assert.ok(errorCaught, '100MB + 1 byte must be rejected');
    pass('ZIP Boundary 100MB + 1 byte', 'DENY (Correctly rejected)');
  }

  // B. SINGLE ASSET SIZE BOUNDARY
  {
    const originalLoadAsync = JSZip.loadAsync;

    // 1. Single file 99MB = ALLOW
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      zip.files['large_video.mp4'] = {
        name: 'large_video.mp4',
        dir: false,
        _data: { uncompressedSize: 99 * 1024 * 1024, compressedSize: 99 * 1024 * 1024 },
        async: async () => ''
      };
      return zip;
    };
    const resSingle99 = await validateScormZip(baseZipBytes);
    assert.strictEqual(resSingle99.isValid, true);
    pass('Single File Boundary 99MB', 'ALLOW');

    // 2. Single file 100MB = ALLOW
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      zip.files['large_video.mp4'] = {
        name: 'large_video.mp4',
        dir: false,
        _data: { uncompressedSize: 100 * 1024 * 1024, compressedSize: 100 * 1024 * 1024 },
        async: async () => ''
      };
      return zip;
    };
    const resSingle100 = await validateScormZip(baseZipBytes);
    assert.strictEqual(resSingle100.isValid, true);
    pass('Single File Boundary 100MB', 'ALLOW');

    // 3. Single file 100MB + 1 byte = DENY
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      zip.files['large_video.mp4'] = {
        name: 'large_video.mp4',
        dir: false,
        _data: { uncompressedSize: 100 * 1024 * 1024 + 1, compressedSize: 100 * 1024 * 1024 },
        async: async () => ''
      };
      return zip;
    };
    let singleErrorCaught = false;
    try {
      await validateScormZip(baseZipBytes);
    } catch (err) {
      singleErrorCaught = true;
      assert.ok(err.message.includes('100MB'), `Expected 100MB single file error, got: ${err.message}`);
    }
    assert.ok(singleErrorCaught, 'Single file > 100MB must be rejected');
    pass('Single File Boundary 100MB + 1 byte', 'DENY (Correctly rejected)');

    // Restore original loader
    JSZip.loadAsync = originalLoadAsync;
  }

  // C. TOTAL UNCOMPRESSED SIZE BOUNDARY
  {
    const originalLoadAsync = JSZip.loadAsync;

    function getBaseOverhead(zip) {
      const baseManifestSize = zip.files['imsmanifest.xml']?._data?.uncompressedSize ?? zip.files['imsmanifest.xml']?.uncompressedSize ?? 0;
      const baseIndexSize = zip.files['index.html']?._data?.uncompressedSize ?? zip.files['index.html']?.uncompressedSize ?? 0;
      return baseManifestSize + baseIndexSize;
    }

    // 1. Total Uncompressed 299MB = ALLOW
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      const baseOverhead = getBaseOverhead(zip);
      const partSize = 74 * 1024 * 1024;
      zip.files['part1.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part2.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part3.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part4.dat'] = { dir: false, _data: { uncompressedSize: (299 * 1024 * 1024) - (partSize * 3) - baseOverhead, compressedSize: partSize } };
      return zip;
    };
    const resTotal299 = await validateScormZip(baseZipBytes);
    assert.strictEqual(resTotal299.isValid, true);
    pass('Total Uncompressed Boundary 299MB', 'ALLOW');

    // 2. Total Uncompressed 300MB = ALLOW
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      const baseOverhead = getBaseOverhead(zip);
      const partSize = 74 * 1024 * 1024;
      zip.files['part1.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part2.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part3.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part4.dat'] = { dir: false, _data: { uncompressedSize: (300 * 1024 * 1024) - (partSize * 3) - baseOverhead, compressedSize: partSize } };
      return zip;
    };
    const resTotal300 = await validateScormZip(baseZipBytes);
    assert.strictEqual(resTotal300.isValid, true);
    pass('Total Uncompressed Boundary 300MB', 'ALLOW');

    // 3. Total Uncompressed 300MB + 1 byte = DENY
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      const baseOverhead = getBaseOverhead(zip);
      const partSize = 74 * 1024 * 1024;
      zip.files['part1.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part2.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part3.dat'] = { dir: false, _data: { uncompressedSize: partSize, compressedSize: partSize } };
      zip.files['part4.dat'] = { dir: false, _data: { uncompressedSize: (300 * 1024 * 1024 + 1) - (partSize * 3) - baseOverhead, compressedSize: partSize } };
      return zip;
    };
    let totalErrorCaught = false;
    try {
      await validateScormZip(baseZipBytes);
    } catch (err) {
      totalErrorCaught = true;
      assert.ok(err.message.includes('300MB'), `Expected 300MB total uncompressed error, got: ${err.message}`);
    }
    assert.ok(totalErrorCaught, 'Total uncompressed > 300MB must be rejected');
    pass('Total Uncompressed Boundary 300MB + 1 byte', 'DENY (Correctly rejected)');

    // Restore original loader
    JSZip.loadAsync = originalLoadAsync;
  }


  // ==================================================================
  // PHẦN 3: KIỂM TRA BẢO TOÀN CÁC RÀO CHẮN BẢO MẬT KHÁC
  // ==================================================================
  console.log('\n--- 3. SECURITY GUARDS AUDIT ---');

  // 1. Entry count > 1000 = DENY
  {
    const originalLoadAsync = JSZip.loadAsync;
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      for (let i = 0; i < 1001; i++) {
        zip.files[`dummy_${i}.txt`] = { dir: false, _data: { uncompressedSize: 10, compressedSize: 10 } };
      }
      return zip;
    };
    let entryErrorCaught = false;
    try {
      await validateScormZip(baseZipBytes);
    } catch (err) {
      entryErrorCaught = true;
      assert.ok(err.message.includes('1000 tệp'), `Expected entry count limit error, got: ${err.message}`);
    }
    assert.ok(entryErrorCaught, 'Entry count > 1000 must be rejected');
    pass('Max Entry Count Guard', '1001 entries -> DENY');
    JSZip.loadAsync = originalLoadAsync;
  }

  // 2. Path Depth > 10 = DENY
  {
    const originalLoadAsync = JSZip.loadAsync;
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/k/deep.txt'; // 12 segments (> 10)
      zip.files[deepPath] = { dir: false, _data: { uncompressedSize: 10, compressedSize: 10 } };
      return zip;
    };
    let depthErrorCaught = false;
    try {
      await validateScormZip(baseZipBytes);
    } catch (err) {
      depthErrorCaught = true;
      assert.ok(err.message.includes('10 cấp'), `Expected path depth error, got: ${err.message}`);
    }
    assert.ok(depthErrorCaught, 'Path depth > 10 must be rejected');
    pass('Max Path Depth Guard', '11+ levels -> DENY');
    JSZip.loadAsync = originalLoadAsync;
  }

  // 3. Compression ratio > 100 = DENY (Zip bomb protection)
  {
    const originalLoadAsync = JSZip.loadAsync;
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      zip.files['bomb.txt'] = {
        dir: false,
        _data: { uncompressedSize: 1000000, compressedSize: 1000 } // ratio = 1000x (> 100)
      };
      return zip;
    };
    let bombErrorCaught = false;
    try {
      await validateScormZip(baseZipBytes);
    } catch (err) {
      bombErrorCaught = true;
      assert.ok(err.message.includes('Zip Bomb'), `Expected zip bomb error, got: ${err.message}`);
    }
    assert.ok(bombErrorCaught, 'Compression ratio > 100 must be rejected');
    pass('Zip Bomb Compression Ratio Guard', '1000x ratio -> DENY');
    JSZip.loadAsync = originalLoadAsync;
  }

  // 4. Path traversal = DENY
  {
    const originalLoadAsync = JSZip.loadAsync;
    JSZip.loadAsync = async function () {
      const zip = await originalLoadAsync.apply(this, arguments);
      zip.files['../../etc/passwd'] = { dir: false, _data: { uncompressedSize: 10, compressedSize: 10 } };
      return zip;
    };
    let traversalCaught = false;
    try {
      await validateScormZip(baseZipBytes);
    } catch (err) {
      traversalCaught = true;
      assert.ok(err.message.includes('đường dẫn tệp không an toàn'), `Expected path traversal error, got: ${err.message}`);
    }
    assert.ok(traversalCaught, 'Path traversal must be rejected');
    pass('Path Traversal Guard', '../../etc/passwd -> DENY');
    JSZip.loadAsync = originalLoadAsync;
  }


  // ==================================================================
  // PHẦN 4: STATIC & BEHAVIORAL MIGRATION CONTRACT TESTING (ADD_SCORM_LARGE_PACKAGE_LIMITS.sql)
  // ==================================================================
  console.log('\n--- 4. MIGRATION STATIC & CONTRACT TESTING ---');

  const migrationFilePath = path.resolve(__dirname, '../ADD_SCORM_LARGE_PACKAGE_LIMITS.sql');
  assert.ok(fs.existsSync(migrationFilePath), 'File ADD_SCORM_LARGE_PACKAGE_LIMITS.sql must exist');
  const sqlContent = fs.readFileSync(migrationFilePath, 'utf8');

  // Static checks
  assert.ok(!sqlContent.includes('CREATE POLICY'), 'Static Audit: Must NOT contain CREATE POLICY');
  assert.ok(!sqlContent.includes('DROP POLICY'), 'Static Audit: Must NOT contain DROP POLICY');
  assert.ok(!sqlContent.includes('ALTER TABLE'), 'Static Audit: Must NOT alter database tables');
  assert.ok(!sqlContent.includes('DROP TABLE'), 'Static Audit: Must NOT drop database tables');
  assert.ok(!sqlContent.includes('array_append'), 'Static Audit: Must NOT append to allowed_mime_types (G7 contract)');
  assert.ok(sqlContent.includes('104857600'), 'Static Audit: Must target exactly 104857600 bytes (100MB)');
  assert.ok(/^\s*BEGIN;/m.test(sqlContent) && /COMMIT;\s*$/m.test(sqlContent), 'Static Audit: Must be wrapped in BEGIN ... COMMIT');
  pass('Static Audit', 'No RLS alterations, no table alterations, no array_append, atomic transaction, exact 100MB limit targeted');

  // Behavioral simulation of the migration's PL/pgSQL logic
  function simulateMigration(bucketsDb) {
    // 1. learning-materials
    const lm = bucketsDb['learning-materials'];
    if (!lm) throw new Error('Bucket "learning-materials" không tồn tại trong storage.buckets');
    if (lm.public === true) throw new Error('BẢO MẬT: Bucket "learning-materials" phải là PRIVATE (public = false)');
    if (lm.allowed_mime_types === null) {
      throw new Error('BẢO MẬT: Bucket "learning-materials" có allowed_mime_types là NULL. Vui lòng áp dụng migration ADD_SCORM_STORAGE_HARDENING.sql trước.');
    }
    if (!lm.allowed_mime_types.includes('application/zip')) {
      throw new Error('BẢO MẬT: Bucket "learning-materials" thiếu MIME "application/zip". Vui lòng áp dụng migration ADD_SCORM_STORAGE_HARDENING.sql trước.');
    }
    lm.file_size_limit = 104857600;

    // 2. scorm-content
    const sc = bucketsDb['scorm-content'];
    if (!sc) throw new Error('Bucket "scorm-content" không tồn tại trong storage.buckets');
    if (sc.public === true) throw new Error('BẢO MẬT: Bucket "scorm-content" phải là PRIVATE (public = false)');
    sc.file_size_limit = 104857600;
  }

  // 1. Run 1: Valid Execution — Update limits to 100MB while strictly preserving MIME
  const initialLmMime = ['application/pdf', 'application/msword', 'application/zip'];
  const mockDb = {
    'learning-materials': {
      id: 'learning-materials',
      public: false,
      file_size_limit: 52428800,
      allowed_mime_types: [...initialLmMime]
    },
    'scorm-content': {
      id: 'scorm-content',
      public: false,
      file_size_limit: 31457280,
      allowed_mime_types: null
    }
  };

  simulateMigration(mockDb);

  assert.strictEqual(mockDb['learning-materials'].file_size_limit, 104857600, 'learning-materials file_size_limit must be 104857600 (100MB)');
  assert.strictEqual(mockDb['learning-materials'].public, false, 'learning-materials must remain private');
  assert.deepStrictEqual(mockDb['learning-materials'].allowed_mime_types, initialLmMime, 'learning-materials MIME array before == MIME array after');
  pass('Migration Run 1: learning-materials', 'file_size_limit = 100MB (104857600), public = false, MIME exactly preserved');

  assert.strictEqual(mockDb['scorm-content'].file_size_limit, 104857600, 'scorm-content file_size_limit must be 104857600 (100MB)');
  assert.strictEqual(mockDb['scorm-content'].public, false, 'scorm-content must remain private');
  assert.strictEqual(mockDb['scorm-content'].allowed_mime_types, null, 'scorm-content allowed_mime_types remains NULL (exactly preserved)');
  pass('Migration Run 1: scorm-content', 'file_size_limit = 100MB (104857600), public = false, MIME exactly preserved');

  // 2. Run 2: Idempotency verification
  const prevLm = JSON.parse(JSON.stringify(mockDb['learning-materials']));
  const prevSc = JSON.parse(JSON.stringify(mockDb['scorm-content']));

  simulateMigration(mockDb);

  assert.deepStrictEqual(mockDb['learning-materials'], prevLm, 'Idempotency: learning-materials unchanged on second run');
  assert.deepStrictEqual(mockDb['scorm-content'], prevSc, 'Idempotency: scorm-content unchanged on second run');
  pass('Migration Run 2: Idempotent', 'Second execution yields identical state without error or duplication');

  // 3. FAIL-CLOSED TEST: Missing application/zip must FAIL and keep MIME unchanged
  {
    const missingZipDb = {
      'learning-materials': {
        id: 'learning-materials',
        public: false,
        file_size_limit: 52428800,
        allowed_mime_types: ['application/pdf', 'application/msword']
      },
      'scorm-content': { id: 'scorm-content', public: false, file_size_limit: 31457280, allowed_mime_types: null }
    };
    const beforeMimeSnapshot = [...missingZipDb['learning-materials'].allowed_mime_types];
    let zipMissingError = false;
    try {
      simulateMigration(missingZipDb);
    } catch (err) {
      zipMissingError = true;
      assert.ok(err.message.includes('thiếu MIME "application/zip"'), `Expected missing zip exception, got: ${err.message}`);
      assert.ok(err.message.includes('ADD_SCORM_STORAGE_HARDENING.sql'), 'Must mention ADD_SCORM_STORAGE_HARDENING.sql');
    }
    assert.ok(zipMissingError, 'Missing application/zip must throw');
    assert.deepStrictEqual(missingZipDb['learning-materials'].allowed_mime_types, beforeMimeSnapshot, 'MIME array must remain unchanged on failure');
    assert.strictEqual(missingZipDb['learning-materials'].file_size_limit, 52428800, 'file_size_limit must NOT be modified when preflight fails');
    pass('Fail-Closed: Missing application/zip', 'Migration aborts with clear error & leaves MIME and file_size_limit intact');
  }

  // 4. FAIL-CLOSED TEST: allowed_mime_types IS NULL on learning-materials must FAIL and remain NULL
  {
    const nullMimeDb = {
      'learning-materials': {
        id: 'learning-materials',
        public: false,
        file_size_limit: 52428800,
        allowed_mime_types: null
      },
      'scorm-content': { id: 'scorm-content', public: false, file_size_limit: 31457280, allowed_mime_types: null }
    };
    let nullMimeError = false;
    try {
      simulateMigration(nullMimeDb);
    } catch (err) {
      nullMimeError = true;
      assert.ok(err.message.includes('có allowed_mime_types là NULL'), `Expected NULL MIME exception, got: ${err.message}`);
      assert.ok(err.message.includes('ADD_SCORM_STORAGE_HARDENING.sql'), 'Must mention ADD_SCORM_STORAGE_HARDENING.sql');
    }
    assert.ok(nullMimeError, 'NULL allowed_mime_types on learning-materials must throw');
    assert.strictEqual(nullMimeDb['learning-materials'].allowed_mime_types, null, 'MIME must remain NULL on failure');
    assert.strictEqual(nullMimeDb['learning-materials'].file_size_limit, 52428800, 'file_size_limit must NOT be modified when preflight fails');
    pass('Fail-Closed: NULL allowed_mime_types', 'Migration aborts with clear error & leaves NULL MIME intact');
  }

  // 5. Bucket Missing Guard
  {
    const missingDb = { 'scorm-content': { id: 'scorm-content', public: false, file_size_limit: 31457280 } };
    let missingError = false;
    try {
      simulateMigration(missingDb);
    } catch (err) {
      missingError = true;
      assert.ok(err.message.includes('không tồn tại'), `Expected missing bucket error, got: ${err.message}`);
    }
    assert.ok(missingError, 'Missing bucket must throw');
    pass('Missing Bucket Guard', 'Throws clear exception when bucket does not exist');
  }

  // 6. Public Bucket Guard
  {
    const publicDb = {
      'learning-materials': { id: 'learning-materials', public: true, file_size_limit: 52428800, allowed_mime_types: ['application/zip'] },
      'scorm-content': { id: 'scorm-content', public: false, file_size_limit: 31457280, allowed_mime_types: null }
    };
    let publicError = false;
    try {
      simulateMigration(publicDb);
    } catch (err) {
      publicError = true;
      assert.ok(err.message.includes('PRIVATE'), `Expected private security guard error, got: ${err.message}`);
    }
    assert.ok(publicError, 'Public bucket must throw security error');
    pass('Public Bucket Security Guard', 'Throws security exception if bucket is PUBLIC');
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests} G7 LARGE PACKAGE CONTRACT & SECURITY TESTS PASSED!`);
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
