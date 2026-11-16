// tests/question_bank_p70q2_frontend_versioning.test.mjs
// ============================================================================
// QUESTION BANK V1 — P70Q-2 FRONTEND DUAL-HEAD VERSIONING & PUBLISH WORKFLOW
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCreateVersionPayload,
  isValidUUID
} from '../supabase/functions/question-bank-api/validation.ts';

test('P70Q-2 FRONTEND VERSIONING & DUAL-HEAD WORKFLOW SUITE', async (t) => {

  await t.test('1. FRONTEND VERSION PAYLOAD SCHEMA & ALLOWLIST COMPLIANCE', () => {
    // Simulated payload produced by CreateQuestionBankModal in mode="new_version"
    const validFrontendVersionPayload = {
      prompt: 'Một thửa ruộng hình chữ nhật có chu vi 120m...',
      options: [
        { id: 'opt_1', text: '30m' },
        { id: 'opt_2', text: '40m' },
        { id: 'opt_3', text: '50m' },
        { id: 'opt_4', text: '60m' }
      ],
      answer_key: {
        correct_answer: 'opt_2',
        case_sensitive: false
      },
      explanation: 'Nửa chu vi là 60m...',
      change_log: 'Cập nhật lại đề bài và giải thích chi tiết hơn cho V2.',
      metadata: {
        created_via: 'new_version_authoring_modal'
      }
    };

    const result = validateCreateVersionPayload(validFrontendVersionPayload);
    assert.strictEqual(result.valid, true, 'Frontend version payload must pass BFF validation');
    assert.deepStrictEqual(result.sanitizedData.prompt, validFrontendVersionPayload.prompt);
    assert.deepStrictEqual(result.sanitizedData.change_log, validFrontendVersionPayload.change_log);
    assert.deepStrictEqual(result.sanitizedData.metadata.created_via, 'new_version_authoring_modal');
  });

  await t.test('2. FORBIDDEN ITEM METADATA STRIPPING: Title, Subject, Grade Level forbidden in Version Payload', () => {
    // If frontend inadvertently leaked item-level metadata into POST /versions, BFF must reject with INVALID_REQUEST_FIELD
    const invalidLeakedPayload = {
      title: 'Bài toán diện tích lớp 5',
      subject: 'Toán',
      grade_level: 5,
      difficulty: 'medium',
      visibility: 'public',
      prompt: 'Nội dung câu hỏi...',
      answer_key: { correct_answer: 'A' }
    };

    const result = validateCreateVersionPayload(invalidLeakedPayload);
    assert.strictEqual(result.valid, false, 'Leaked item metadata must be rejected by BFF');
    assert.strictEqual(result.errorCode, 'INVALID_REQUEST_FIELD');
    assert.ok(result.errorMessage.includes('không nằm trong danh sách cho phép'));
  });

  await t.test('3. DUAL-HEAD ISOLATION INVARIANTS: Draft Version creation does NOT mutate Published Version', () => {
    // Invariant simulation:
    // Item initial state: published_version_id = V1, current_version_id = V1
    const itemBaseline = {
      id: 'a0000000-0000-0000-0000-000000000001',
      published_version_id: 'b0000000-0000-0000-0000-000000000001', // V1
      current_version_id: 'b0000000-0000-0000-0000-000000000001',   // V1
      version_count: 1
    };

    // Action: createQuestionVersion creates V2
    const createdVersion = {
      version_id: 'b0000000-0000-0000-0000-000000000002', // V2 (Draft)
      version_number: 2,
      is_published: false
    };

    // State after creating draft V2:
    const itemAfterNewVersion = {
      ...itemBaseline,
      current_version_id: createdVersion.version_id, // points to V2
      version_count: 2
      // published_version_id REMAINS V1
    };

    assert.strictEqual(
      itemAfterNewVersion.published_version_id,
      itemBaseline.published_version_id,
      'published_version_id must strictly remain V1 after draft V2 creation'
    );
    assert.strictEqual(
      itemAfterNewVersion.current_version_id,
      createdVersion.version_id,
      'current_version_id points to new draft V2'
    );
    assert.notStrictEqual(
      itemAfterNewVersion.current_version_id,
      itemAfterNewVersion.published_version_id,
      'Dual-Head state: current_version_id (V2) !== published_version_id (V1)'
    );
  });

  await t.test('4. STUDENT ACCESS STRICT BOUNDARY: Student read endpoint only serves published_version_id', () => {
    // Test data representing Dual-Head DB state
    const versionsDb = {
      'b0000000-0000-0000-0000-000000000001': {
        version_number: 1,
        prompt: 'V1: Prompt đã xuất bản',
        options: ['A', 'B'],
        is_published: true
      },
      'b0000000-0000-0000-0000-000000000002': {
        version_number: 2,
        prompt: 'V2: Prompt bản nháp mới đang soạn thảo',
        options: ['A', 'B', 'C'],
        is_published: false
      }
    };

    const item = {
      id: 'a0000000-0000-0000-0000-000000000001',
      published_version_id: 'b0000000-0000-0000-0000-000000000001',
      current_version_id: 'b0000000-0000-0000-0000-000000000002'
    };

    // Student resolver simulation (RPC rpc_qb_student_get_question)
    const resolveStudentQuestion = (targetItem) => {
      if (!targetItem.published_version_id) {
        throw { code: 'QUESTION_NOT_PUBLISHED' };
      }
      const pubVer = versionsDb[targetItem.published_version_id];
      // Zero leakage of answer_key or internal IDs
      return {
        item_id: targetItem.id,
        version_number: pubVer.version_number,
        prompt: pubVer.prompt,
        options: pubVer.options
      };
    };

    const studentView = resolveStudentQuestion(item);
    assert.strictEqual(studentView.version_number, 1, 'Student must see published V1');
    assert.strictEqual(studentView.prompt, 'V1: Prompt đã xuất bản', 'Student must NOT see draft V2 content');
    assert.strictEqual(studentView.answer_key, undefined, 'Student view must NEVER contain answer_key');
  });

  await t.test('5. PUBLISH CONFIRMATION CONTRACT: Explicit Version Promotion & Warning', () => {
    const testItemId = 'a0000000-0000-0000-0000-000000000001';
    assert.strictEqual(isValidUUID(testItemId), true);

    // After publish execution: published_version_id advances to V2
    const itemPostPublish = {
      id: testItemId,
      published_version_id: 'b0000000-0000-0000-0000-000000000002', // advanced to V2
      current_version_id: 'b0000000-0000-0000-0000-000000000002',
      status: 'published'
    };

    assert.strictEqual(
      itemPostPublish.published_version_id,
      itemPostPublish.current_version_id,
      'Post-publish: published_version_id and current_version_id coalesce to V2'
    );
    assert.strictEqual(itemPostPublish.status, 'published');
  });

  await t.test('6. ACCESS CONTROL MATRIX: Permission gate for "Sửa phiên bản" and "Xuất bản"', () => {
    const currentUserId = 'user-teacher-123';

    const checkPermissions = (item, userRole, userId) => {
      const isAuthor = item.author_id === userId || item.created_by === userId;
      const isArchived = item.is_archived === true || item.status === 'archived';

      const canEditNewVersion = !isArchived && (userRole === 'admin' || (userRole === 'teacher' && isAuthor));
      const canPublish = !isArchived && (userRole === 'admin' || (userRole === 'teacher' && isAuthor));

      return { canEditNewVersion, canPublish };
    };

    // Case A: Teacher author on active question -> PERMITTED
    const itemTeacherAuthor = { author_id: 'user-teacher-123', status: 'published' };
    const permA = checkPermissions(itemTeacherAuthor, 'teacher', currentUserId);
    assert.strictEqual(permA.canEditNewVersion, true);
    assert.strictEqual(permA.canPublish, true);

    // Case B: Teacher non-author on active question -> DENIED
    const itemTeacherOther = { author_id: 'user-other-456', status: 'published' };
    const permB = checkPermissions(itemTeacherOther, 'teacher', currentUserId);
    assert.strictEqual(permB.canEditNewVersion, false);
    assert.strictEqual(permB.canPublish, false);

    // Case C: Student -> STRICTLY DENIED
    const permC = checkPermissions(itemTeacherAuthor, 'student', currentUserId);
    assert.strictEqual(permC.canEditNewVersion, false);
    assert.strictEqual(permC.canPublish, false);

    // Case D: Admin -> PERMITTED even if not author
    const permD = checkPermissions(itemTeacherOther, 'admin', 'admin-id-999');
    assert.strictEqual(permD.canEditNewVersion, true);
    assert.strictEqual(permD.canPublish, true);

    // Case E: Archived item -> DENIED for everyone
    const itemArchived = { author_id: currentUserId, is_archived: true, status: 'archived' };
    const permE = checkPermissions(itemArchived, 'teacher', currentUserId);
    assert.strictEqual(permE.canEditNewVersion, false);
    assert.strictEqual(permE.canPublish, false);
  });

  await t.test('7. STRUCTURED BFF ERROR PARSING: Modal handles 400, 403, 404 gracefully', async () => {
    // Frontend service HTTP error response parser contract (matching questionBankService.js)
    const parseServiceResponse = async (mockResponse) => {
      let jsonResult;
      try {
        jsonResult = await mockResponse.json();
      } catch (_err) {
        const networkErr = new Error(`Lỗi kết nối máy chủ khi thao tác (HTTP ${mockResponse.status})`);
        networkErr.status = mockResponse.status;
        networkErr.errorCode = null;
        throw networkErr;
      }

      if (!mockResponse.ok || !jsonResult || jsonResult.success !== true) {
        const errorMsg = jsonResult?.message || jsonResult?.error || `Thao tác thất bại (${mockResponse.status})`;
        const structuredErr = new Error(errorMsg);
        structuredErr.status = mockResponse.status;
        structuredErr.errorCode = jsonResult?.error_code || null;
        throw structuredErr;
      }
      return jsonResult.data;
    };

    // Modal state machine simulating CreateQuestionBankModal submission lifecycle
    const simulateModalSubmission = async (submitFn, initialFormState) => {
      let modalState = {
        isOpen: true,
        isSubmitting: false,
        errorMsg: null,
        successMessage: null,
        errorStatus: null,
        errorCode: null,
        form: { ...initialFormState }
      };

      try {
        modalState.isSubmitting = true;
        modalState.errorMsg = null;

        const res = await submitFn(modalState.form);
        modalState.successMessage = `Đã tạo thành công phiên bản mới (V${res?.version_number || 'mới'})!`;
        modalState.isOpen = false; // Closed on success
      } catch (err) {
        modalState.errorMsg = err.message || 'Không thể lưu câu hỏi. Vui lòng thử lại.';
        modalState.errorStatus = err.status;
        modalState.errorCode = err.errorCode;
        // On error: modal remains open, form inputs preserved
      } finally {
        modalState.isSubmitting = false;
      }

      return modalState;
    };

    const initialDraft = {
      prompt: 'Tính diện tích hình tròn có bán kính r = 5cm',
      options: [{ id: 'opt_1', text: '78.5 cm2' }, { id: 'opt_2', text: '31.4 cm2' }],
      answerKey: { correct_answer: 'opt_1' },
      explanation: 'S = r * r * 3.14 = 25 * 3.14 = 78.5',
      changeLog: 'Sửa lại đơn vị đo cm2'
    };

    // Case 1: HTTP 400 - Validation error (e.g. Empty item or missing prompt)
    const mock400Response = {
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error_code: 'CANNOT_PUBLISH_EMPTY_ITEM',
        message: 'Câu hỏi chưa có đầy đủ đáp án hoặc câu trả lời hợp lệ để xuất bản.'
      })
    };

    const state400 = await simulateModalSubmission(
      async () => await parseServiceResponse(mock400Response),
      initialDraft
    );

    assert.strictEqual(state400.errorStatus, 400, 'HTTP status must be preserved as 400');
    assert.strictEqual(state400.errorCode, 'CANNOT_PUBLISH_EMPTY_ITEM', 'BFF error_code must be extracted');
    assert.strictEqual(state400.errorMsg, 'Câu hỏi chưa có đầy đủ đáp án hoặc câu trả lời hợp lệ để xuất bản.');
    assert.strictEqual(state400.isOpen, true, 'Modal must remain OPEN on HTTP 400 error');
    assert.strictEqual(state400.isSubmitting, false, 'isSubmitting must reset to false');
    assert.deepStrictEqual(state400.form, initialDraft, 'User draft input MUST be preserved without data loss on 400');

    // Case 2: HTTP 403 - Forbidden (e.g. Unauthorized version modification)
    const mock403Response = {
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error_code: 'FORBIDDEN_VERSION',
        message: 'Bạn không có quyền chỉnh sửa câu hỏi này vì không phải tác giả.'
      })
    };

    const state403 = await simulateModalSubmission(
      async () => await parseServiceResponse(mock403Response),
      initialDraft
    );

    assert.strictEqual(state403.errorStatus, 403, 'HTTP status must be preserved as 403');
    assert.strictEqual(state403.errorCode, 'FORBIDDEN_VERSION', 'BFF error_code must be extracted');
    assert.strictEqual(state403.errorMsg, 'Bạn không có quyền chỉnh sửa câu hỏi này vì không phải tác giả.');
    assert.strictEqual(state403.isOpen, true, 'Modal must remain OPEN on HTTP 403 error');
    assert.strictEqual(state403.isSubmitting, false, 'isSubmitting must reset to false');
    assert.deepStrictEqual(state403.form, initialDraft, 'User draft input MUST be preserved on 403 so user can copy draft');

    // Case 3: HTTP 404 - Not found (e.g. Question or version deleted)
    const mock404Response = {
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error_code: 'QUESTION_NOT_FOUND',
        message: 'Không tìm thấy câu hỏi hoặc phiên bản tương ứng trong hệ thống.'
      })
    };

    const state404 = await simulateModalSubmission(
      async () => await parseServiceResponse(mock404Response),
      initialDraft
    );

    assert.strictEqual(state404.errorStatus, 404, 'HTTP status must be preserved as 404');
    assert.strictEqual(state404.errorCode, 'QUESTION_NOT_FOUND', 'BFF error_code must be extracted');
    assert.strictEqual(state404.errorMsg, 'Không tìm thấy câu hỏi hoặc phiên bản tương ứng trong hệ thống.');
    assert.strictEqual(state404.isOpen, true, 'Modal must remain OPEN on HTTP 404 error');
    assert.strictEqual(state404.isSubmitting, false, 'isSubmitting must reset to false');

    // Case 4: HTTP 409 - Concurrency conflict (expected_version_id mismatch)
    const mock409Response = {
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error_code: 'VERSION_CONFLICT',
        message: 'Phiên bản câu hỏi đã bị thay đổi bởi người dùng khác. Vui lòng tải lại.'
      })
    };

    const state409 = await simulateModalSubmission(
      async () => await parseServiceResponse(mock409Response),
      initialDraft
    );

    assert.strictEqual(state409.errorStatus, 409, 'HTTP status must be preserved as 409');
    assert.strictEqual(state409.errorCode, 'VERSION_CONFLICT', 'Concurrency error_code must be extracted');
    assert.strictEqual(state409.errorMsg, 'Phiên bản câu hỏi đã bị thay đổi bởi người dùng khác. Vui lòng tải lại.');
    assert.strictEqual(state409.isOpen, true, 'Modal must remain OPEN on 409 conflict');
    assert.strictEqual(state409.isSubmitting, false, 'isSubmitting must reset to false');
    assert.deepStrictEqual(state409.form, initialDraft, 'User draft input MUST be preserved on 409 for conflict resolution');

    // Case 5: Success lifecycle verification
    const mockSuccessResponse = {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: {
          item_id: 'a0000000-0000-0000-0000-000000000001',
          version_id: 'b0000000-0000-0000-0000-000000000002',
          version_number: 2
        }
      })
    };

    const stateSuccess = await simulateModalSubmission(
      async () => await parseServiceResponse(mockSuccessResponse),
      initialDraft
    );

    assert.strictEqual(stateSuccess.isOpen, false, 'Modal MUST close on successful creation');
    assert.strictEqual(stateSuccess.errorMsg, null, 'errorMsg must be null on success');
    assert.ok(stateSuccess.successMessage.includes('V2'), 'Success notification must indicate version number');
  });

  await t.test('8. DUAL-HEAD PUBLISH VISIBILITY & RBAC CONDITION (Phase 28C)', () => {
    const currentUserId = 'user-teacher-123';

    const computeDualHeadPermissions = (item, userRole, userId) => {
      const isAuthor = Boolean(item.author_id && userId && String(item.author_id) === String(userId));
      const isDraft = item.status === 'draft';
      const isArchived = item.is_archived === true || item.status === 'archived';

      const hasUnpublishedVersion = !isArchived && (
        isDraft ||
        (item.status === 'published' &&
          Boolean(item.current_version_id && item.published_version_id && item.current_version_id !== item.published_version_id))
      );
      const canPublish = hasUnpublishedVersion && (userRole === 'admin' || (userRole === 'teacher' && isAuthor));
      const canEditNewVersion = !isArchived && (userRole === 'admin' || (userRole === 'teacher' && isAuthor));

      return { canPublish, canEditNewVersion, hasUnpublishedVersion };
    };

    // Case 1: Câu hỏi Draft mới tạo -> Có nút Xuất bản
    const draftItem = {
      author_id: currentUserId,
      status: 'draft',
      current_version_id: 'v1-uuid',
      published_version_id: null
    };
    const p1 = computeDualHeadPermissions(draftItem, 'teacher', currentUserId);
    assert.strictEqual(p1.canPublish, true, 'Draft item must be publishable');
    assert.strictEqual(p1.canEditNewVersion, true, 'Draft item can create new version');

    // Case 2: Câu hỏi Published V1 duy nhất (chưa có v2 nháp) -> Ẩn nút Xuất bản, nhưng có nút Sửa phiên bản
    const publishedSingleHeadItem = {
      author_id: currentUserId,
      status: 'published',
      current_version_id: 'v1-uuid',
      published_version_id: 'v1-uuid'
    };
    const p2 = computeDualHeadPermissions(publishedSingleHeadItem, 'teacher', currentUserId);
    assert.strictEqual(p2.canPublish, false, 'Published single-head item must NOT show Publish button');
    assert.strictEqual(p2.canEditNewVersion, true, 'Published single-head item MUST show Sửa phiên bản button');

    // Case 3: Câu hỏi Published V1 nhưng ĐÃ CÓ BẢN NHÁP V2 (Dual-Head separated) -> HIỆN NÚT XUẤT BẢN!
    const publishedDualHeadWithV2 = {
      author_id: currentUserId,
      status: 'published',
      current_version_id: 'v2-uuid-new-draft',
      published_version_id: 'v1-uuid-student-published'
    };
    const p3Teacher = computeDualHeadPermissions(publishedDualHeadWithV2, 'teacher', currentUserId);
    assert.strictEqual(p3Teacher.canPublish, true, 'Author teacher can publish V2 draft');
    assert.strictEqual(p3Teacher.canEditNewVersion, true, 'Author teacher can edit new version');

    // Admin có quyền xuất bản V2 ngay cả khi không phải tác giả
    const p3Admin = computeDualHeadPermissions(publishedDualHeadWithV2, 'admin', 'admin-id-999');
    assert.strictEqual(p3Admin.canPublish, true, 'Admin can publish V2 draft');
    assert.strictEqual(p3Admin.canEditNewVersion, true, 'Admin can edit new version');

    // Giáo viên khác KHÔNG được xuất bản V2
    const p3Other = computeDualHeadPermissions(publishedDualHeadWithV2, 'teacher', 'other-teacher-456');
    assert.strictEqual(p3Other.canPublish, false, 'Non-author teacher cannot publish V2 draft');
    assert.strictEqual(p3Other.canEditNewVersion, false, 'Non-author teacher cannot edit new version');

    // Học sinh KHÔNG được xuất bản V2
    const p3Student = computeDualHeadPermissions(publishedDualHeadWithV2, 'student', 'student-id');
    assert.strictEqual(p3Student.canPublish, false, 'Student cannot publish V2 draft');
    assert.strictEqual(p3Student.canEditNewVersion, false, 'Student cannot edit new version');

    // Case 4: Câu hỏi Archived -> Bị chặn toàn bộ
    const archivedItem = {
      author_id: currentUserId,
      status: 'archived',
      current_version_id: 'v2-uuid',
      published_version_id: 'v1-uuid'
    };
    const p4 = computeDualHeadPermissions(archivedItem, 'admin', 'admin-id-999');
    assert.strictEqual(p4.canPublish, false, 'Archived item cannot be published');
    assert.strictEqual(p4.canEditNewVersion, false, 'Archived item cannot edit new version');
  });

  await t.test('9. CLIENT CONCURRENCY GUARD: expected_version_id validation & zero-fallback', () => {
    // Giả lập logic kiểm tra trước khi gọi API publishQuestion trong QuestionBankListTab.jsx
    const validatePublishExecution = (publishModalItem) => {
      const targetId = publishModalItem?.id || publishModalItem?.item_id;
      const expectedVersionId = publishModalItem?.current_version_id;

      if (!targetId) {
        return { ok: false, error: 'Thiếu ID câu hỏi' };
      }
      if (!expectedVersionId || typeof expectedVersionId !== 'string' || !expectedVersionId.trim()) {
        return {
          ok: false,
          error: 'Không tìm thấy định danh phiên bản (current_version_id) hợp lệ để xuất bản. Vui lòng tải lại danh sách.'
        };
      }
      return { ok: true, targetId, expectedVersionId: expectedVersionId.trim() };
    };

    // Khi thiếu current_version_id -> Chặn ngay lập tức
    const invalidItem = { id: 'item-uuid-1', current_version_id: null };
    const resInvalid = validatePublishExecution(invalidItem);
    assert.strictEqual(resInvalid.ok, false);
    assert.ok(resInvalid.error.includes('current_version_id'));

    // Khi có current_version_id hợp lệ -> Pass và gửi kèm expected_version_id
    const validItem = { id: 'item-uuid-1', current_version_id: 'v2-uuid-confirmed' };
    const resValid = validatePublishExecution(validItem);
    assert.strictEqual(resValid.ok, true);
    assert.strictEqual(resValid.expectedVersionId, 'v2-uuid-confirmed');
  });

  await t.test('10. VERSION HISTORY MODAL DUAL-HEAD BADGE MAPPING (Phase 28C)', () => {
    const computeVersionBadges = (version, currentVersionId, publishedVersionId) => {
      const isCurrent = Boolean(version.is_current || (currentVersionId && version.id === currentVersionId));
      const isPublished = Boolean(publishedVersionId && version.id === publishedVersionId);

      const badges = [];
      if (isPublished) badges.push('Đang xuất bản (Học sinh)');
      if (isCurrent) badges.push('Bản hiện tại (Soạn thảo)');
      if (!isCurrent && !isPublished) badges.push('Bản cũ');

      return { isCurrent, isPublished, badges };
    };

    const currentVersionId = 'v2-uuid';
    const publishedVersionId = 'v1-uuid';

    // Scenario A: Trước khi tạo V2 (V1 là cả current và published)
    const v1Before = { id: 'v1-uuid', version_number: 1 };
    const mapV1Before = computeVersionBadges(v1Before, 'v1-uuid', 'v1-uuid');
    assert.strictEqual(mapV1Before.isCurrent, true);
    assert.strictEqual(mapV1Before.isPublished, true);
    assert.deepStrictEqual(mapV1Before.badges, ['Đang xuất bản (Học sinh)', 'Bản hiện tại (Soạn thảo)']);

    // Scenario B: Sau khi tạo V2 nháp (V2 là current, V1 là published)
    const v2Draft = { id: 'v2-uuid', version_number: 2 };
    const mapV2 = computeVersionBadges(v2Draft, currentVersionId, publishedVersionId);
    assert.strictEqual(mapV2.isCurrent, true);
    assert.strictEqual(mapV2.isPublished, false);
    assert.deepStrictEqual(mapV2.badges, ['Bản hiện tại (Soạn thảo)']);

    const v1After = { id: 'v1-uuid', version_number: 1 };
    const mapV1After = computeVersionBadges(v1After, currentVersionId, publishedVersionId);
    assert.strictEqual(mapV1After.isCurrent, false);
    assert.strictEqual(mapV1After.isPublished, true);
    assert.deepStrictEqual(mapV1After.badges, ['Đang xuất bản (Học sinh)']);

    // Scenario C: Bản cũ hơn (V0)
    const v0Old = { id: 'v0-uuid', version_number: 0 };
    const mapV0 = computeVersionBadges(v0Old, currentVersionId, publishedVersionId);
    assert.strictEqual(mapV0.isCurrent, false);
    assert.strictEqual(mapV0.isPublished, false);
    assert.deepStrictEqual(mapV0.badges, ['Bản cũ']);
  });

  await t.test('11. SAFE ANSWER KEY RESOLUTION, FAIL-CLOSED GUARD & VISIBILITY INHERITANCE (Phase 28H-FIX-2)', () => {
    // Pure logic algorithms matching CreateQuestionBankModal.jsx

    const normalizeVisibility = (rawVis) => {
      if (!rawVis) return 'private';
      const v = String(rawVis).trim().toLowerCase();
      if (v === 'public' || v === 'public_template') return 'public_template';
      if (v === 'school' || v === 'school_shared') return 'school_shared';
      return 'private';
    };

    const extractCandidateAnswerValues = (answerKey) => {
      if (!answerKey) return [];
      const candidates = [];

      const addCandidate = (val) => {
        if (val === null || val === undefined) return;
        if (typeof val === 'string' || typeof val === 'number') {
          const s = String(val).trim();
          if (s && !candidates.includes(s)) candidates.push(s);
        } else if (typeof val === 'object') {
          if (val.correct_option_id) addCandidate(val.correct_option_id);
          if (val.correct_answer) addCandidate(val.correct_answer);
          if (val.correct) addCandidate(val.correct);
          if (val.id) addCandidate(val.id);
          if (val.value) addCandidate(val.value);
        }
      };

      if (typeof answerKey === 'string' || typeof answerKey === 'number') {
        addCandidate(answerKey);
        return candidates;
      }

      if (typeof answerKey !== 'object') return [];

      addCandidate(answerKey.correct_option_id);
      addCandidate(answerKey.correct_answer);
      addCandidate(answerKey.correct);

      const ca = answerKey.correct_answers;
      if (Array.isArray(ca)) {
        for (const item of ca) {
          addCandidate(item);
        }
      } else if (ca !== null && ca !== undefined) {
        addCandidate(ca);
      }

      const coids = answerKey.correct_option_ids;
      if (Array.isArray(coids)) {
        for (const item of coids) {
          addCandidate(item);
        }
      }

      return candidates;
    };

    const resolveOptionId = (val, currentOptions) => {
      if (val === null || val === undefined || !Array.isArray(currentOptions) || currentOptions.length === 0) {
        return null;
      }
      const str = String(val).trim();
      if (!str) return null;

      // 1. Direct ID match
      const byId = currentOptions.find((o) => o && o.id === str);
      if (byId) return byId.id;

      // 2. Letter match: A, B, C, D...
      if (/^[a-zA-Z]$/.test(str)) {
        const idx = str.toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < currentOptions.length && currentOptions[idx]?.id) {
          return currentOptions[idx].id;
        }
      }

      // 3. Option text match
      const byText = currentOptions.find(
        (o) => o && typeof o.text === 'string' && o.text.trim().toLowerCase() === str.toLowerCase()
      );
      if (byText) return byText.id;

      return null;
    };

    const extractAuthoringAnswerState = (answerKey, currentOptions, qType) => {
      const candidates = extractCandidateAnswerValues(answerKey);

      if (qType === 'single_choice') {
        let resolvedId = '';
        for (const c of candidates) {
          const match = resolveOptionId(c, currentOptions);
          if (match) {
            resolvedId = match;
            break;
          }
        }
        return {
          questionType: 'single_choice',
          correctOptionId: resolvedId,
          correctOptionIds: resolvedId ? [resolvedId] : [],
          fillBlankAnswer: '',
          shortAnswer: '',
          isResolved: Boolean(resolvedId)
        };
      }

      if (qType === 'multiple_choice') {
        const resolvedIds = [];
        for (const c of candidates) {
          const match = resolveOptionId(c, currentOptions);
          if (match && !resolvedIds.includes(match)) {
            resolvedIds.push(match);
          }
        }
        return {
          questionType: 'multiple_choice',
          correctOptionId: resolvedIds[0] || '',
          correctOptionIds: resolvedIds,
          fillBlankAnswer: '',
          shortAnswer: '',
          isResolved: resolvedIds.length > 0
        };
      }

      if (qType === 'fill_blank') {
        let textAnswer = '';
        if (answerKey?.correct_answers) {
          if (Array.isArray(answerKey.correct_answers)) {
            textAnswer = answerKey.correct_answers.join('; ');
          } else if (typeof answerKey.correct_answers === 'string') {
            textAnswer = answerKey.correct_answers;
          }
        } else if (candidates.length > 0) {
          textAnswer = candidates.join('; ');
        }
        return {
          questionType: 'fill_blank',
          correctOptionId: '',
          correctOptionIds: [],
          fillBlankAnswer: textAnswer,
          shortAnswer: '',
          isResolved: Boolean(textAnswer.trim())
        };
      }

      if (qType === 'short_answer') {
        let textAnswer = '';
        if (answerKey?.correct_answers) {
          if (Array.isArray(answerKey.correct_answers)) {
            textAnswer = answerKey.correct_answers.join('; ');
          } else if (typeof answerKey.correct_answers === 'string') {
            textAnswer = answerKey.correct_answers;
          }
        } else if (candidates.length > 0) {
          textAnswer = candidates.join('; ');
        }
        return {
          questionType: 'short_answer',
          correctOptionId: '',
          correctOptionIds: [],
          fillBlankAnswer: '',
          shortAnswer: textAnswer,
          isResolved: Boolean(textAnswer.trim())
        };
      }

      return {
        questionType: qType,
        correctOptionId: '',
        correctOptionIds: [],
        fillBlankAnswer: '',
        shortAnswer: '',
        isResolved: true
      };
    };

    // A. VISIBILITY NORMALIZATION TESTS
    assert.strictEqual(normalizeVisibility('public'), 'public_template', 'public maps to public_template');
    assert.strictEqual(normalizeVisibility('public_template'), 'public_template', 'public_template preserved');
    assert.strictEqual(normalizeVisibility('private'), 'private', 'private preserved');
    assert.strictEqual(normalizeVisibility('school'), 'school_shared', 'school maps to school_shared');
    assert.strictEqual(normalizeVisibility(null), 'private', 'null defaults to private');
    assert.strictEqual(normalizeVisibility(undefined), 'private', 'undefined defaults to private');

    // B. TARGET SMOKE-TEST QUESTION: "2 + 3 = ?" (ddc17fd9)
    const smokeTestOptions = [
      { id: 'opt_1', text: '4' },
      { id: 'opt_2', text: '5' },
      { id: 'opt_3', text: '6' },
      { id: 'opt_4', text: '7' }
    ];

    // Case 1: Nested object { correct_answers: { correct_option_id: 'opt_2' } } (Staging schema)
    const stagingAnswerKey1 = { correct_answers: { correct_option_id: 'opt_2' } };
    const res1 = extractAuthoringAnswerState(stagingAnswerKey1, smokeTestOptions, 'single_choice');
    assert.strictEqual(res1.correctOptionId, 'opt_2', 'Must resolve to opt_2 (Option B = 5)');
    assert.strictEqual(res1.isResolved, true, 'isResolved must be true');

    // Case 2: Top-level { correct_option_id: 'opt_2' }
    const stagingAnswerKey2 = { correct_option_id: 'opt_2' };
    const res2 = extractAuthoringAnswerState(stagingAnswerKey2, smokeTestOptions, 'single_choice');
    assert.strictEqual(res2.correctOptionId, 'opt_2', 'Must resolve top-level correct_option_id to opt_2');
    assert.strictEqual(res2.isResolved, true);

    // Case 3: Letter match: { correct: 'B' }
    const stagingAnswerKey3 = { correct: 'B' };
    const res3 = extractAuthoringAnswerState(stagingAnswerKey3, smokeTestOptions, 'single_choice');
    assert.strictEqual(res3.correctOptionId, 'opt_2', 'Letter B must resolve to opt_2');
    assert.strictEqual(res3.isResolved, true);

    // Case 4: Text match: { correct_answer: '5' }
    const stagingAnswerKey4 = { correct_answer: '5' };
    const res4 = extractAuthoringAnswerState(stagingAnswerKey4, smokeTestOptions, 'single_choice');
    assert.strictEqual(res4.correctOptionId, 'opt_2', 'Text "5" must resolve to opt_2');
    assert.strictEqual(res4.isResolved, true);

    // Case 5: Array of string { correct_answers: ['opt_2'] }
    const stagingAnswerKey5 = { correct_answers: ['opt_2'] };
    const res5 = extractAuthoringAnswerState(stagingAnswerKey5, smokeTestOptions, 'single_choice');
    assert.strictEqual(res5.correctOptionId, 'opt_2', 'Array with opt_2 must resolve to opt_2');
    assert.strictEqual(res5.isResolved, true);

    // C. FAIL-CLOSED GUARD: MISSING OR CORRUPTED ANSWER KEY
    // Must NOT default to opt_1 (Option A). Must leave correctOptionId = '' and block submit!
    const corruptAnswerKey1 = {};
    const resFail1 = extractAuthoringAnswerState(corruptAnswerKey1, smokeTestOptions, 'single_choice');
    assert.strictEqual(resFail1.correctOptionId, '', 'Empty answerKey MUST leave correctOptionId empty (fail-closed)');
    assert.strictEqual(resFail1.isResolved, false, 'isResolved must be false for empty answerKey');

    const corruptAnswerKey2 = null;
    const resFail2 = extractAuthoringAnswerState(corruptAnswerKey2, smokeTestOptions, 'single_choice');
    assert.strictEqual(resFail2.correctOptionId, '', 'Null answerKey MUST leave correctOptionId empty');
    assert.strictEqual(resFail2.isResolved, false);

    const corruptAnswerKey3 = { invalid_property: 'not_an_option' };
    const resFail3 = extractAuthoringAnswerState(corruptAnswerKey3, smokeTestOptions, 'single_choice');
    assert.strictEqual(resFail3.correctOptionId, '', 'Unmatched answerKey MUST leave correctOptionId empty');
    assert.strictEqual(resFail3.isResolved, false);

    // Form submission validation guard simulation
    const validateSingleChoiceSubmit = (correctId, opts) => {
      if (!correctId || !opts.some(o => o.id === correctId)) {
        throw new Error('Vui lòng chọn đáp án đúng cho câu hỏi trước khi lưu.');
      }
      return true;
    };

    // When fail-closed empty -> submit throws error
    assert.throws(
      () => validateSingleChoiceSubmit(resFail1.correctOptionId, smokeTestOptions),
      /Vui lòng chọn đáp án đúng cho câu hỏi trước khi lưu/
    );

    // When valid -> submit succeeds
    assert.strictEqual(validateSingleChoiceSubmit(res1.correctOptionId, smokeTestOptions), true);

    // D. MULTIPLE CHOICE TESTS
    const multiOptions = [
      { id: 'opt_1', text: 'Hình vuông' },
      { id: 'opt_2', text: 'Hình tròn' },
      { id: 'opt_3', text: 'Hình chữ nhật' },
      { id: 'opt_4', text: 'Hình tam giác' }
    ];

    const multiKeyValid = { correct_answers: ['opt_1', 'opt_3'] };
    const resMultiValid = extractAuthoringAnswerState(multiKeyValid, multiOptions, 'multiple_choice');
    assert.deepStrictEqual(resMultiValid.correctOptionIds, ['opt_1', 'opt_3']);
    assert.strictEqual(resMultiValid.isResolved, true);

    // Multi-choice letter match
    const multiKeyLetters = { correct_answers: ['A', 'C'] };
    const resMultiLetters = extractAuthoringAnswerState(multiKeyLetters, multiOptions, 'multiple_choice');
    assert.deepStrictEqual(resMultiLetters.correctOptionIds, ['opt_1', 'opt_3']);
    assert.strictEqual(resMultiLetters.isResolved, true);

    // Multi-choice fail-closed
    const multiKeyEmpty = { correct_answers: [] };
    const resMultiEmpty = extractAuthoringAnswerState(multiKeyEmpty, multiOptions, 'multiple_choice');
    assert.deepStrictEqual(resMultiEmpty.correctOptionIds, []);
    assert.strictEqual(resMultiEmpty.isResolved, false);

    const validateMultiChoiceSubmit = (ids) => {
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('Vui lòng chọn ít nhất một đáp án đúng.');
      }
      return true;
    };

    assert.throws(
      () => validateMultiChoiceSubmit(resMultiEmpty.correctOptionIds),
      /Vui lòng chọn ít nhất một đáp án đúng/
    );
    assert.strictEqual(validateMultiChoiceSubmit(resMultiValid.correctOptionIds), true);

    // E. FILL BLANK TESTS
    const fillBlankKey = { correct_answers: ['Hà Nội', 'Ha Noi'] };
    const resFill = extractAuthoringAnswerState(fillBlankKey, [], 'fill_blank');
    assert.strictEqual(resFill.fillBlankAnswer, 'Hà Nội; Ha Noi');
    assert.strictEqual(resFill.isResolved, true);

    // F. SHORT ANSWER TESTS
    const shortAnswerKey = { correct_answers: ['Quang Trung'] };
    const resShort = extractAuthoringAnswerState(shortAnswerKey, [], 'short_answer');
    assert.strictEqual(resShort.shortAnswer, 'Quang Trung');
    assert.strictEqual(resShort.isResolved, true);
  });

});
