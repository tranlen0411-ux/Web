// tests/bulk_import_idempotency_lifecycle.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ============================================================================
// MÔ PHỎNG BACKEND IDEMPOTENCY ENGINE (Khớp chính xác với Edge Function & DB)
// ============================================================================
class MockBackendIdempotencyEngine {
  constructor() {
    this.idempotencyRecords = new Map(); // key: idempotency_key -> { payload_fingerprint, status, response }
    this.receipts = new Map(); // token -> { classId, canonicalFingerprint, status }
  }

  computePayloadFingerprint(classId, dryRun, students) {
    const sortedNames = students
      .map(s => (s.fullName || s.full_name || '').trim().replace(/\s+/g, ' '))
      .sort()
      .join('|');
    const raw = `${classId}_dry:${dryRun}_${sortedNames}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  computeCanonicalFingerprint(classId, students) {
    const canonicalNames = students
      .map(s => (s.fullName || s.full_name || '').trim().toLowerCase().replace(/\s+/g, ' '))
      .sort()
      .join('|');
    const material = `class:${classId}|names:${canonicalNames}`;
    return crypto.createHash('sha256').update(material).digest('hex');
  }

  // Giả lập RPC claim_batch_idempotency
  claimIdempotency(idempotencyKey, payloadFingerprint) {
    const existing = this.idempotencyRecords.get(idempotencyKey);
    if (existing) {
      if (existing.payload_fingerprint !== payloadFingerprint) {
        return {
          success: false,
          status: 'PAYLOAD_MISMATCH',
          message: 'Mã Idempotency Key này đã được sử dụng cho một danh sách học sinh khác.',
        };
      }
      return {
        success: true,
        status: existing.status || 'COMPLETED',
        message: 'Idempotency key replayed successfully',
        response: existing.response,
      };
    }

    this.idempotencyRecords.set(idempotencyKey, {
      payload_fingerprint: payloadFingerprint,
      status: 'PROCESSING',
      response: null,
    });

    return {
      success: true,
      status: 'CLAIMED',
      message: 'Idempotency key claimed',
    };
  }

  completeIdempotency(idempotencyKey, response) {
    const rec = this.idempotencyRecords.get(idempotencyKey);
    if (rec) {
      rec.status = 'COMPLETED';
      rec.response = response;
    }
  }

  // Giả lập Dry-run handler
  handleDryRun({ classId, students, idempotencyKey }) {
    if (!idempotencyKey) {
      return { success: false, status: 400, message: 'Thiếu idempotencyKey.' };
    }

    const payloadFingerprint = this.computePayloadFingerprint(classId, true, students);
    const claim = this.claimIdempotency(idempotencyKey, payloadFingerprint);
    if (!claim.success) {
      return { success: false, status: 400, message: claim.message };
    }

    const canonicalFingerprint = this.computeCanonicalFingerprint(classId, students);
    const dryRunToken = crypto.randomUUID();
    this.receipts.set(dryRunToken, {
      classId,
      canonicalFingerprint,
      status: 'ISSUED',
    });

    const resData = {
      success: true,
      dryRunToken,
      summary: { readyToCreate: students.length, reviewRequired: 0 },
      results: students.map((s, i) => ({ stt: i + 1, fullName: s.fullName, status: 'READY_TO_CREATE' })),
    };

    this.completeIdempotency(idempotencyKey, resData);
    return { success: true, status: 200, data: resData };
  }

  // Giả lập Execute handler
  handleExecute({ classId, students, idempotencyKey, dryRunToken }) {
    if (!idempotencyKey) {
      return { success: false, status: 400, message: 'Thiếu idempotencyKey.' };
    }
    if (!dryRunToken) {
      return { success: false, status: 400, message: 'Thiếu dryRunToken chứng thực Dry-Run.' };
    }

    const receipt = this.receipts.get(dryRunToken);
    if (!receipt) {
      return { success: false, status: 400, message: 'dryRunToken không tồn tại hoặc đã hết hạn.' };
    }

    const canonicalFingerprint = this.computeCanonicalFingerprint(classId, students);
    if (receipt.classId !== classId || receipt.canonicalFingerprint !== canonicalFingerprint) {
      return { success: false, status: 400, message: 'Dữ liệu thực thi không khớp với bản chứng thực Dry-Run.' };
    }

    const payloadFingerprint = this.computePayloadFingerprint(classId, false, students);
    const claim = this.claimIdempotency(idempotencyKey, payloadFingerprint);
    if (!claim.success) {
      return { success: false, status: 400, message: claim.message };
    }

    if (claim.status === 'COMPLETED' && claim.response) {
      return { success: true, status: 200, data: { ...claim.response, replayed: true } };
    }

    const resData = {
      success: true,
      batchId: crypto.randomUUID(),
      summary: { created: students.length, assignedExisting: 0 },
      results: students.map((s, i) => ({
        stt: i + 1,
        fullName: s.fullName,
        studentCode: `HS_${i + 1}`,
        pin: '123456',
        status: 'CREATED_NEW',
      })),
    };

    this.completeIdempotency(idempotencyKey, resData);
    return { success: true, status: 200, data: resData };
  }
}

// ============================================================================
// MÔ PHỎNG FRONTEND IMPORT MODAL STATE MACHINE
// ============================================================================
class MockImportModalStateMachine {
  constructor(mode = 'FIXED') {
    this.mode = mode; // 'BUGGY' | 'FIXED'
    this.isOpen = false;
    this.step = 1;
    this.selectedClassId = 'class_1a';
    this.rawNamesText = '';
    this.parsedStudents = [];
    this.dryRunData = null;
    this.dryRunToken = null;
    this.prodResult = null;
    this.isConfirmChecked = false;

    // Buggy implementation: static once at mount
    this.idempotencyKey = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  generateNewKey() {
    this.idempotencyKey = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return this.idempotencyKey;
  }

  open() {
    this.isOpen = true;
    if (this.mode === 'FIXED') {
      this.generateNewKey();
    }
  }

  close() {
    this.isOpen = false;
    this.step = 1;
    this.dryRunData = null;
    this.dryRunToken = null;
    this.prodResult = null;
    this.isConfirmChecked = false;
    if (this.mode === 'FIXED') {
      this.generateNewKey();
    }
  }

  changeClass(newClassId) {
    this.selectedClassId = newClassId;
    this.dryRunData = null;
    this.dryRunToken = null;
    this.isConfirmChecked = false;
    if (this.mode === 'FIXED') {
      this.generateNewKey();
    }
  }

  parseNames(text) {
    this.rawNamesText = text;
    const lines = text.split('\n');
    const list = [];
    let count = 1;
    for (const line of lines) {
      const trimmed = line.trim().replace(/\s+/g, ' ');
      if (trimmed) {
        list.push({ stt: count++, fullName: trimmed });
      }
    }
    this.parsedStudents = list;
    this.dryRunData = null;
    this.dryRunToken = null;
    this.isConfirmChecked = false;
    if (this.mode === 'FIXED') {
      this.generateNewKey();
    }
    this.step = 2;
  }

  runDryRun(backend) {
    const res = backend.handleDryRun({
      classId: this.selectedClassId,
      students: this.parsedStudents,
      idempotencyKey: `${this.idempotencyKey}_dry`,
    });
    if (res.success) {
      this.dryRunData = res.data;
      this.dryRunToken = res.data.dryRunToken;
      this.step = 3;
    }
    return res;
  }

  executeProduction(backend) {
    const res = backend.handleExecute({
      classId: this.selectedClassId,
      students: this.parsedStudents,
      idempotencyKey: this.idempotencyKey,
      dryRunToken: this.dryRunToken,
    });
    if (res.success) {
      this.prodResult = res.data;
      this.step = 4;
    }
    return res;
  }
}

// ============================================================================
// TEST SUITE: TÁI HIỆN LỖI VÀ KIỂM ĐỊNH FIX BẢO VỆ IDEMPOTENCY KEY
// ============================================================================
test('SUITE: BULK IMPORT IDEMPOTENCY LIFECYCLE & STALE KEY PREVENTION', async (t) => {
  await t.test('1. TÁI HIỆN LỖI: Buggy Frontend reuse stale key -> Backend báo PAYLOAD_MISMATCH', () => {
    const backend = new MockBackendIdempotencyEngine();
    const buggyModal = new MockImportModalStateMachine('BUGGY');

    // Batch A: Nhập danh sách A vào lớp 1A
    buggyModal.open();
    buggyModal.changeClass('class_1a');
    buggyModal.parseNames('Nguyen Van A\nTran Thi B');
    const dryResA = buggyModal.runDryRun(backend);
    assert.equal(dryResA.success, true, 'Batch A Dry Run phải thành công');

    buggyModal.isConfirmChecked = true;
    const execResA = buggyModal.executeProduction(backend);
    assert.equal(execResA.success, true, 'Batch A Execute phải thành công');

    // Admin đóng modal
    buggyModal.close();

    // Admin mở lại modal và nhập Batch B (danh sách khác)
    buggyModal.open();
    buggyModal.changeClass('class_1a');
    buggyModal.parseNames('Le Van C\nPham Thi D');

    // Dry Run Batch B với buggy frontend -> Sẽ gửi cùng stale key `${K1}_dry`
    const dryResB = buggyModal.runDryRun(backend);

    assert.equal(dryResB.success, false, 'Buggy frontend tái hiện lỗi xung đột idempotency key');
    assert.equal(dryResB.message, 'Mã Idempotency Key này đã được sử dụng cho một danh sách học sinh khác.');
  });

  await t.test('2. FIX: Same list + same batch -> Dry-Run -> Execute dùng cùng key và receipt binding hợp lệ', () => {
    const backend = new MockBackendIdempotencyEngine();
    const fixedModal = new MockImportModalStateMachine('FIXED');

    fixedModal.open();
    fixedModal.changeClass('class_1a');
    fixedModal.parseNames('Nguyen Van A\nTran Thi B');

    const keyBeforeDryRun = fixedModal.idempotencyKey;
    const dryRes = fixedModal.runDryRun(backend);
    assert.equal(dryRes.success, true);
    assert.ok(fixedModal.dryRunToken, 'Phải có dryRunToken hợp lệ');

    // Key phải được giữ nguyên từ Dry Run sang Execute cho CÙNG 1 batch
    assert.equal(fixedModal.idempotencyKey, keyBeforeDryRun, 'Cùng batch phải giữ nguyên idempotency key');

    fixedModal.isConfirmChecked = true;
    const execRes = fixedModal.executeProduction(backend);
    assert.equal(execRes.success, true);
    assert.equal(fixedModal.step, 4, 'Chuyển sang bước 4 hoàn tất');
  });

  await t.test('3. FIX: Batch mới (danh sách khác) -> Idempotency key mới được tạo, không bị lỗi xung đột', () => {
    const backend = new MockBackendIdempotencyEngine();
    const fixedModal = new MockImportModalStateMachine('FIXED');

    // Batch A
    fixedModal.open();
    fixedModal.changeClass('class_1a');
    fixedModal.parseNames('Nguyen Van A\nTran Thi B');
    const dryResA = fixedModal.runDryRun(backend);
    assert.equal(dryResA.success, true);
    fixedModal.isConfirmChecked = true;
    const execResA = fixedModal.executeProduction(backend);
    assert.equal(execResA.success, true);

    const keyA = fixedModal.idempotencyKey;

    // Đóng modal và mở lại cho Batch B
    fixedModal.close();
    fixedModal.open();

    const keyB = fixedModal.idempotencyKey;
    assert.notEqual(keyA, keyB, 'Batch mới sau khi đóng/mở modal phải có Idempotency Key mới');

    fixedModal.changeClass('class_1a');
    fixedModal.parseNames('Le Van C\nPham Thi D');
    const dryResB = fixedModal.runDryRun(backend);
    assert.equal(dryResB.success, true, 'Batch B Dry-Run phải thành công mỹ mãn mà không bị conflict');

    fixedModal.isConfirmChecked = true;
    const execResB = fixedModal.executeProduction(backend);
    assert.equal(execResB.success, true, 'Batch B Execute thành công');
  });

  await t.test('4. FIX: Đổi lớp đích -> Idempotency key mới và invalidate dryRunToken cũ', () => {
    const backend = new MockBackendIdempotencyEngine();
    const fixedModal = new MockImportModalStateMachine('FIXED');

    fixedModal.open();
    fixedModal.changeClass('class_1a');
    fixedModal.parseNames('Nguyen Van A\nTran Thi B');
    fixedModal.runDryRun(backend);

    const keyClass1A = fixedModal.idempotencyKey;
    assert.ok(fixedModal.dryRunToken);

    // Đổi sang lớp 1B
    fixedModal.changeClass('class_1b');
    assert.equal(fixedModal.dryRunToken, null, 'dryRunToken cũ phải bị xóa khi đổi lớp');
    assert.notEqual(fixedModal.idempotencyKey, keyClass1A, 'Đổi lớp đích phải sinh idempotency key mới');

    const dryRes1B = fixedModal.runDryRun(backend);
    assert.equal(dryRes1B.success, true, 'Dry run lớp mới thành công');
  });

  await t.test('5. FIX: Sửa danh sách học sinh trong form -> Idempotency key mới được cấp phát', () => {
    const backend = new MockBackendIdempotencyEngine();
    const fixedModal = new MockImportModalStateMachine('FIXED');

    fixedModal.open();
    fixedModal.changeClass('class_1a');
    fixedModal.parseNames('Nguyen Van A\nTran Thi B');
    fixedModal.runDryRun(backend);

    const key1 = fixedModal.idempotencyKey;

    // Quay lại bước 1 sửa danh sách
    fixedModal.step = 1;
    fixedModal.parseNames('Nguyen Van A\nTran Thi B\nLe Hoang C');

    const key2 = fixedModal.idempotencyKey;
    assert.notEqual(key1, key2, 'Sửa danh sách phải cấp Idempotency Key mới');
    assert.equal(fixedModal.dryRunToken, null, 'dryRunToken cũ phải bị reset');

    const dryRes2 = fixedModal.runDryRun(backend);
    assert.equal(dryRes2.success, true, 'Dry run với danh sách đã sửa thành công');
  });

  await t.test('6. Repeated Execute từ cùng valid receipt -> Bảo tồn replay idempotency của backend', () => {
    const backend = new MockBackendIdempotencyEngine();
    const fixedModal = new MockImportModalStateMachine('FIXED');

    fixedModal.open();
    fixedModal.changeClass('class_1a');
    fixedModal.parseNames('Nguyen Van A\nTran Thi B');
    fixedModal.runDryRun(backend);
    fixedModal.isConfirmChecked = true;

    const exec1 = fixedModal.executeProduction(backend);
    assert.equal(exec1.success, true);
    assert.equal(exec1.data.replayed, undefined);

    // Mô phỏng mạng bị giật và frontend retry execute với cùng key & receipt
    const exec2 = fixedModal.executeProduction(backend);
    assert.equal(exec2.success, true);
    assert.equal(exec2.data.replayed, true, 'Backend bảo tồn cơ chế replay an toàn cho cùng idempotency key');
  });
});
