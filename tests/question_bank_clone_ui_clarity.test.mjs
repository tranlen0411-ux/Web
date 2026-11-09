// tests/question_bank_clone_ui_clarity.test.mjs
// Suite for R2-B6G-5P29: Question Bank Clone UI Clarity Fix
// Tests: Origin badges, Vietnam datetime formatting, Modal visibility, Permissions, and Clone flow integrity

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVietnamDateTime,
  getQuestionOriginInfo,
  getModalVisibilityDisplay
} from '../src/components/dashboard/question-bank/questionBankHelpers.js';

/**
 * Pure helper mirroring row permissions from QuestionBankListTab.jsx
 */
function computeRowPermissions({ role, currentUserId, item }) {
  const isAuthor = Boolean(item.author_id && currentUserId && String(item.author_id) === String(currentUserId));
  const isOwnQuestion = isAuthor;
  const isPublicQuestion = item.visibility === 'public_template' || item.visibility === 'public';
  const isSharedFromOtherTeacher = role === 'teacher' &&
    item.status === 'published' &&
    isPublicQuestion &&
    !isOwnQuestion;
  const isDraft = item.status === 'draft';
  const isArchived = item.status === 'archived';

  const canPublish = isDraft && (role === 'admin' || (role === 'teacher' && isAuthor));
  const canShare = item.status === 'published' && item.visibility === 'private' && (role === 'admin' || (role === 'teacher' && isAuthor));
  const canUnshare = item.status === 'published' && isPublicQuestion && (role === 'admin' || (role === 'teacher' && isAuthor));
  const canArchive = !isArchived && (role === 'admin' || (role === 'teacher' && isAuthor));
  const canRestore = isArchived && (role === 'admin' || (role === 'teacher' && isAuthor));
  const canDelete = (role === 'admin' || (role === 'teacher' && isAuthor)) && !isSharedFromOtherTeacher;
  const canViewHistory = role === 'admin' || (role === 'teacher' && isAuthor);
  const canClone = !isArchived && (
    role === 'admin' ||
    (role === 'teacher' && (isOwnQuestion || (item.status === 'published' && isPublicQuestion)))
  );
  const canAssignToClass = isOwnQuestion && item.status === 'published' && (role === 'admin' || role === 'teacher');

  return {
    isAuthor,
    isOwnQuestion,
    isPublicQuestion,
    isSharedFromOtherTeacher,
    isDraft,
    isArchived,
    canPublish,
    canShare,
    canUnshare,
    canArchive,
    canRestore,
    canDelete,
    canViewHistory,
    canClone,
    canAssignToClass
  };
}

/**
 * Pure helper mirroring handleConfirmClone payload logic
 */
function createForkPayload(cloneModalItem) {
  if (!cloneModalItem || !cloneModalItem.current_version_id) {
    throw new Error('Không tìm thấy phiên bản câu hỏi nguồn để sao chép.');
  }
  return {
    sourceVersionId: cloneModalItem.current_version_id,
    body: {
      title: `${cloneModalItem.title || cloneModalItem.prompt || 'Câu hỏi'} (Bản sao)`,
      visibility: 'private'
    }
  };
}

test('R2-B6G-5P29: Question Bank Clone UI Clarity Fix Suite', async (t) => {

  await t.test('1. QUESTION ORIGIN RESOLUTION (BẢN SAO VS CÂU GỐC)', async (t2) => {
    await t2.test('1.1. Valid forked_from_version_id string marks item as "Bản sao"', () => {
      const item = {
        id: 'd0285eed-6f31-438a-a21c-352d31988d40',
        forked_from_version_id: 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab'
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'clone');
      assert.equal(info.label, 'Bản sao');
      assert.equal(info.isClone, true);
      assert.equal(info.isOriginal, false);
      assert.equal(info.forkedFromVersionId, 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab');
    });

    await t2.test('1.2. Valid metadata.forked_from_version_id marks item as "Bản sao"', () => {
      const item = {
        id: 'item-with-meta',
        metadata: { forked_from_version_id: 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab' }
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'clone');
      assert.equal(info.label, 'Bản sao');
      assert.equal(info.isClone, true);
      assert.equal(info.forkedFromVersionId, 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab');
    });

    await t2.test('1.3. Explicit null forked_from_version_id marks item as "Câu gốc"', () => {
      const item = {
        id: '8f1d022f-5102-4d60-8bc9-67928273bdff',
        forked_from_version_id: null
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'original');
      assert.equal(info.label, 'Câu gốc');
      assert.equal(info.isClone, false);
      assert.equal(info.isOriginal, true);
      assert.equal(info.forkedFromVersionId, null);
    });

    await t2.test('1.4. Explicit null metadata.forked_from_version_id is Fail-Closed UNKNOWN (corrupted field)', () => {
      const item = {
        id: 'item-original-meta',
        metadata: { forked_from_version_id: null }
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'unknown');
      assert.equal(info.label, null, 'Must NOT assume Original when metadata has corrupted/null fork field');
      assert.equal(info.isClone, false);
      assert.equal(info.isOriginal, false);
    });

    await t2.test('1.5. Tri-State API Contract: origin_status="clone" gives "Bản sao"', () => {
      const item = {
        id: 'item-tri-clone',
        origin_status: 'clone',
        forked_from_version_id: 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab'
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'clone');
      assert.equal(info.label, 'Bản sao');
      assert.equal(info.isClone, true);
      assert.equal(info.forkedFromVersionId, 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab');
    });

    await t2.test('1.6. Tri-State API Contract: origin_status="original" gives "Câu gốc"', () => {
      const item = {
        id: 'item-tri-orig',
        origin_status: 'original',
        forked_from_version_id: null
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'original');
      assert.equal(info.label, 'Câu gốc');
      assert.equal(info.isClone, false);
      assert.equal(info.isOriginal, true);
    });

    await t2.test('1.7. Tri-State API Contract: origin_status="unknown" NEVER gives "Câu gốc" (Fail-Closed)', () => {
      const item = {
        id: 'item-tri-unknown',
        origin_status: 'unknown',
        forked_from_version_id: null
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'unknown');
      assert.equal(info.label, null);
      assert.equal(info.isClone, false);
      assert.equal(info.isOriginal, false);
    });

    await t2.test('1.8. Malformed UUID in metadata gives UNKNOWN (Fail-Closed)', () => {
      const item = {
        id: 'item-malformed-meta',
        metadata: { forked_from_version_id: 'not-a-valid-uuid-string' }
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'unknown');
      assert.equal(info.label, null);
      assert.equal(info.isClone, false);
      assert.equal(info.isOriginal, false);
    });

    await t2.test('1.9. Clone edited to Version 2 or 3 retains "Bản sao" via item metadata', () => {
      const itemV2 = {
        id: 'd0285eed-6f31-438a-a21c-352d31988d40',
        version_count: 2,
        current_version_id: 'version-2-uuid',
        forked_from_version_id: null, // current version in DB has null
        metadata: { forked_from_version_id: 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab' }
      };
      const info = getQuestionOriginInfo(itemV2);
      assert.equal(info.type, 'clone');
      assert.equal(info.label, 'Bản sao');
      assert.equal(info.isClone, true);
      assert.equal(info.forkedFromVersionId, 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab');
    });

    await t2.test('1.10. Missing forked_from_version_id does NOT guess from title with "(Bản sao)"', () => {
      const item = {
        id: 'item-no-fork-info',
        title: 'Câu hỏi kiểm thử Toán 10 (Bản sao)',
        forked_from_version_id: undefined
      };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'unknown');
      assert.equal(info.label, null, 'Must NOT render "Bản sao" label purely from title string');
      assert.equal(info.isClone, false);
      assert.equal(info.isOriginal, false);
    });

    await t2.test('1.11. Whitespace/empty forked_from_version_id is treated as unknown', () => {
      const item = { id: 'item-empty-fork', forked_from_version_id: '   ' };
      const info = getQuestionOriginInfo(item);
      assert.equal(info.type, 'unknown');
      assert.equal(info.label, null);
    });

    await t2.test('1.12. Null/undefined item returns safe unknown object', () => {
      assert.equal(getQuestionOriginInfo(null).label, null);
      assert.equal(getQuestionOriginInfo(undefined).label, null);
      assert.equal(getQuestionOriginInfo({}).label, null);
    });
  });

  await t.test('2. VIETNAM CREATED_AT DATE & TIME FORMATTING (Asia/Ho_Chi_Minh)', async (t2) => {
    await t2.test('2.1. Valid UTC ISO timestamp converts accurately to Vietnam local time (UTC+7)', () => {
      // 13:54:18 UTC = 20:54:18 UTC+7
      const formatted = formatVietnamDateTime('2026-11-08T13:54:18.428282Z');
      assert.match(formatted, /^20:54:18\s+08\/11\/2026$/);
    });

    await t2.test('2.2. Timestamp with +00 offset converts accurately', () => {
      // 23:56:48 UTC (Nov 7) = 06:56:48 UTC+7 (Nov 8)
      const formatted = formatVietnamDateTime('2026-11-07 23:56:48.005578+00');
      assert.match(formatted, /^06:56:48\s+08\/11\/2026$/);
    });

    await t2.test('2.3. Missing/null/empty created_at displays "—", never substitutes updated_at', () => {
      const itemWithUpdatedOnly = {
        created_at: null,
        updated_at: '2026-11-08T13:54:18.428282Z'
      };
      assert.equal(formatVietnamDateTime(itemWithUpdatedOnly.created_at), '—');
      assert.equal(formatVietnamDateTime(undefined), '—');
      assert.equal(formatVietnamDateTime(''), '—');
      assert.equal(formatVietnamDateTime('   '), '—');
    });

    await t2.test('2.4. Malformed date string displays "—" safely without crashing', () => {
      assert.equal(formatVietnamDateTime('invalid-date-string'), '—');
      assert.equal(formatVietnamDateTime(12345678), '—');
      assert.equal(formatVietnamDateTime(NaN), '—');
    });
  });

  await t.test('3. MODAL VISIBILITY DISPLAY RESOLVER (FIX HARCODED LABEL)', async (t2) => {
    await t2.test('3.1. visibility="private" displays "Riêng tư" with Lock', () => {
      const vis = getModalVisibilityDisplay('private');
      assert.equal(vis.label, 'Riêng tư');
      assert.match(vis.className, /slate/);
    });

    await t2.test('3.2. visibility="public" displays "Mẫu công khai" with Globe', () => {
      const vis = getModalVisibilityDisplay('public');
      assert.equal(vis.label, 'Mẫu công khai');
      assert.match(vis.className, /emerald/);
    });

    await t2.test('3.3. visibility="public_template" displays "Mẫu công khai" with Globe', () => {
      const vis = getModalVisibilityDisplay('public_template');
      assert.equal(vis.label, 'Mẫu công khai');
      assert.match(vis.className, /emerald/);
    });

    await t2.test('3.4. visibility="school" displays "Nội bộ trường"', () => {
      const vis = getModalVisibilityDisplay('school');
      assert.equal(vis.label, 'Nội bộ trường');
      assert.match(vis.className, /indigo/);
    });

    await t2.test('3.5. visibility="school_shared" displays "Nội bộ trường"', () => {
      const vis = getModalVisibilityDisplay('school_shared');
      assert.equal(vis.label, 'Nội bộ trường');
      assert.match(vis.className, /indigo/);
    });

    await t2.test('3.6. Unknown or undefined visibility displays neutral fallback, NEVER "Mẫu công khai"', () => {
      const visNull = getModalVisibilityDisplay(null);
      assert.equal(visNull.label, 'Chưa xác định');
      assert.notEqual(visNull.label, 'Mẫu công khai');

      const visUndef = getModalVisibilityDisplay(undefined);
      assert.equal(visUndef.label, 'Chưa xác định');
      assert.notEqual(visUndef.label, 'Mẫu công khai');

      const visCustom = getModalVisibilityDisplay('custom_scope');
      assert.equal(visCustom.label, 'custom_scope');
      assert.notEqual(visCustom.label, 'Mẫu công khai');
    });
  });

  await t.test('4. LONG TITLE & HOVER DISPLAY BEHAVIOR', async (t2) => {
    await t2.test('4.1. Long title (200+ chars) preserves full text for title attribute tooltip', () => {
      const longTitle = 'Đề thi chọn học sinh giỏi môn Toán cấp thành phố năm học 2026-2027: Một bài toán hình học phẳng kết hợp số học nâng cao về định lý Euler và đường thẳng Simson với các trường hợp mở rộng đặc biệt';
      const item = { title: longTitle, prompt: null };
      const fullTitle = item.title || item.prompt || '(Không có tiêu đề)';
      assert.equal(fullTitle, longTitle);
      assert.equal(fullTitle.length > 150, true);
    });

    await t2.test('4.2. Empty title falls back to prompt or "(Không có tiêu đề)"', () => {
      const itemPrompt = { title: null, prompt: 'Đề bài ngắn' };
      assert.equal(itemPrompt.title || itemPrompt.prompt || '(Không có tiêu đề)', 'Đề bài ngắn');

      const itemEmpty = { title: '', prompt: null };
      assert.equal(itemEmpty.title || itemEmpty.prompt || '(Không có tiêu đề)', '(Không có tiêu đề)');
    });
  });

  await t.test('5. PERMISSION MATRIX FOR CLONE BUTTON (ADMIN, TEACHER, STUDENT)', async (t2) => {
    const ADMIN_ID = 'admin-001';
    const TEACHER_1 = 'teacher-001';
    const TEACHER_2 = 'teacher-002';
    const STUDENT_1 = 'student-001';

    await t2.test('5.1. Admin sees Clone on own and foreign unarchived questions', () => {
      const ownDraft = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: { author_id: ADMIN_ID, status: 'draft', visibility: 'private' }
      });
      assert.equal(ownDraft.canClone, true);

      const foreignDraft = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: { author_id: TEACHER_1, status: 'draft', visibility: 'private' }
      });
      assert.equal(foreignDraft.canClone, true);
    });

    await t2.test('5.2. Admin does NOT see Clone on archived questions', () => {
      const archived = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: { author_id: ADMIN_ID, status: 'archived', visibility: 'private' }
      });
      assert.equal(archived.canClone, false);
    });

    await t2.test('5.3. Teacher sees Clone on own draft/published and foreign public published', () => {
      const ownDraft = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_1,
        item: { author_id: TEACHER_1, status: 'draft', visibility: 'private' }
      });
      assert.equal(ownDraft.canClone, true);

      const foreignPublic = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_1,
        item: { author_id: TEACHER_2, status: 'published', visibility: 'public' }
      });
      assert.equal(foreignPublic.canClone, true);
    });

    await t2.test('5.4. Teacher does NOT see Clone on foreign draft or foreign private published (Fail-Closed)', () => {
      const foreignPrivateDraft = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_1,
        item: { author_id: TEACHER_2, status: 'draft', visibility: 'private' }
      });
      assert.equal(foreignPrivateDraft.canClone, false);

      const foreignPrivatePublished = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_1,
        item: { author_id: TEACHER_2, status: 'published', visibility: 'private' }
      });
      assert.equal(foreignPrivatePublished.canClone, false);
    });

    await t2.test('5.5. Student NEVER sees Clone button (Fail-Closed)', () => {
      const studentOnPublic = computeRowPermissions({
        role: 'student',
        currentUserId: STUDENT_1,
        item: { author_id: TEACHER_1, status: 'published', visibility: 'public' }
      });
      assert.equal(studentOnPublic.canClone, false);

      const studentOnPrivate = computeRowPermissions({
        role: 'student',
        currentUserId: STUDENT_1,
        item: { author_id: TEACHER_1, status: 'published', visibility: 'private' }
      });
      assert.equal(studentOnPrivate.canClone, false);
    });
  });

  await t.test('6. HANDLE CONFIRM CLONE PAYLOAD INTEGRITY', async (t2) => {
    await t2.test('6.1. Cloned title has "(Bản sao)" suffix and visibility is strictly "private"', () => {
      const item = {
        id: '8f1d022f-5102-4d60-8bc9-67928273bdff',
        current_version_id: 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab',
        title: '[TEST-FIXTURE] Kiểm thử Ngân Hàng Câu Hỏi R2-B6G-5P10',
        visibility: 'private'
      };
      const payload = createForkPayload(item);
      assert.equal(payload.sourceVersionId, 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab');
      assert.equal(payload.body.title, '[TEST-FIXTURE] Kiểm thử Ngân Hàng Câu Hỏi R2-B6G-5P10 (Bản sao)');
      assert.equal(payload.body.visibility, 'private');
    });

    await t2.test('6.2. Missing current_version_id throws error before calling API', () => {
      assert.throws(() => {
        createForkPayload({ id: 'no-version-item', title: 'Test' });
      }, /Không tìm thấy phiên bản câu hỏi nguồn để sao chép/);
    });
  });

});

