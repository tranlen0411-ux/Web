// tests/question_bank_clone_visibility_matrix.test.mjs
// Regression test suite for R2-B6G-5P28B: Safe Clone Button Visibility Alignment
// Tests: role × ownership × status × visibility matrix for canClone & other actions

import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure function mirroring the permission computation logic in QuestionBankListTab.jsx
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

  // Permissions
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

test('R2-B6G-5P28B: Question Bank Clone Button Visibility Matrix Suite', async (t) => {

  const ADMIN_ID = 'admin-uuid-0001';
  const TEACHER_A_ID = 'teacher-uuid-0001';
  const TEACHER_B_ID = 'teacher-uuid-0002';
  const STUDENT_ID = 'student-uuid-0001';

  await t.test('1. ADMIN ROLE PERMISSIONS', async (t2) => {
    await t2.test('1.1. Admin sees Clone button on fixture P10 (foreign, draft, private)', () => {
      const perms = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: {
          id: '8f1d022f-5102-4d60-8bc9-67928273bdff',
          author_id: TEACHER_A_ID,
          status: 'draft',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, true, 'Admin must see Clone button on draft private fixture');
      assert.equal(perms.canPublish, true, 'Admin can also publish draft');
      assert.equal(perms.canArchive, true, 'Admin can archive unarchived question');
      assert.equal(perms.canDelete, true, 'Admin can delete');
      assert.equal(perms.canViewHistory, true, 'Admin can view history');
    });

    await t2.test('1.2. Admin sees Clone button on own draft question', () => {
      const perms = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: {
          id: 'item-admin-own',
          author_id: ADMIN_ID,
          status: 'draft',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, true);
    });

    await t2.test('1.3. Admin sees Clone button on published public question', () => {
      const perms = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: {
          id: 'item-pub',
          author_id: TEACHER_A_ID,
          status: 'published',
          visibility: 'public_template'
        }
      });
      assert.equal(perms.canClone, true);
    });

    await t2.test('1.4. Admin does NOT see Clone button on archived question', () => {
      const perms = computeRowPermissions({
        role: 'admin',
        currentUserId: ADMIN_ID,
        item: {
          id: 'item-archived',
          author_id: TEACHER_A_ID,
          status: 'archived',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, false, 'Archived questions must never show Clone button');
      assert.equal(perms.canRestore, true, 'Admin can restore archived question');
      assert.equal(perms.canPublish, false, 'Cannot publish archived question');
    });
  });

  await t.test('2. TEACHER ROLE PERMISSIONS', async (t2) => {
    await t2.test('2.1. Teacher sees Clone button on own draft private question (duplication)', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_A_ID,
        item: {
          id: 'item-teacher-a-own',
          author_id: TEACHER_A_ID,
          status: 'draft',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, true, 'Teacher must be able to clone their own question');
      assert.equal(perms.canPublish, true, 'Author teacher can publish their draft');
      assert.equal(perms.canDelete, true, 'Author teacher can delete their question');
    });

    await t2.test('2.2. Teacher sees Clone button on own published question', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_A_ID,
        item: {
          id: 'item-teacher-a-pub',
          author_id: TEACHER_A_ID,
          status: 'published',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, true);
    });

    await t2.test('2.3. Teacher sees Clone button on published public_template from another teacher', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_B_ID,
        item: {
          id: 'item-teacher-a-shared',
          author_id: TEACHER_A_ID,
          status: 'published',
          visibility: 'public_template'
        }
      });
      assert.equal(perms.canClone, true, 'Teacher B can clone public_template shared from Teacher A');
      assert.equal(perms.isSharedFromOtherTeacher, true);
      assert.equal(perms.canDelete, false, 'Teacher B must NOT be able to delete Teacher A shared question');
      assert.equal(perms.canPublish, false, 'Teacher B cannot publish Teacher A question');
      assert.equal(perms.canArchive, false, 'Teacher B cannot archive Teacher A question');
    });

    await t2.test('2.4. Teacher sees Clone button on published public (canonical) from another teacher', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_B_ID,
        item: {
          id: 'item-teacher-a-public',
          author_id: TEACHER_A_ID,
          status: 'published',
          visibility: 'public'
        }
      });
      assert.equal(perms.canClone, true, 'Teacher B can clone canonical public question');
      assert.equal(perms.isSharedFromOtherTeacher, true);
      assert.equal(perms.canDelete, false);
    });

    await t2.test('2.5. Teacher does NOT see Clone button on private draft from another teacher (Fail-Closed)', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_B_ID,
        item: {
          id: '8f1d022f-5102-4d60-8bc9-67928273bdff',
          author_id: TEACHER_A_ID,
          status: 'draft',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, false, 'Teacher B must NOT see clone button on Teacher A private draft');
      assert.equal(perms.canDelete, false);
      assert.equal(perms.canPublish, false);
    });

    await t2.test('2.6. Teacher does NOT see Clone button on private published from another teacher (Fail-Closed)', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_B_ID,
        item: {
          id: 'item-teacher-a-private-pub',
          author_id: TEACHER_A_ID,
          status: 'published',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, false, 'Teacher B must NOT see clone button on Teacher A private published question');
    });

    await t2.test('2.7. Teacher does NOT see Clone button on archived question even if own', () => {
      const perms = computeRowPermissions({
        role: 'teacher',
        currentUserId: TEACHER_A_ID,
        item: {
          id: 'item-teacher-a-archived',
          author_id: TEACHER_A_ID,
          status: 'archived',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, false, 'Archived own question cannot be cloned');
      assert.equal(perms.canRestore, true, 'Author teacher can restore archived question');
    });
  });

  await t.test('3. STUDENT ROLE PERMISSIONS (FAIL-CLOSED)', async (t2) => {
    await t2.test('3.1. Student NEVER sees Clone button on public question', () => {
      const perms = computeRowPermissions({
        role: 'student',
        currentUserId: STUDENT_ID,
        item: {
          id: 'item-pub',
          author_id: TEACHER_A_ID,
          status: 'published',
          visibility: 'public_template'
        }
      });
      assert.equal(perms.canClone, false, 'Student must NEVER see clone button');
      assert.equal(perms.canPublish, false);
      assert.equal(perms.canDelete, false);
      assert.equal(perms.canArchive, false);
      assert.equal(perms.canViewHistory, false);
    });

    await t2.test('3.2. Student NEVER sees Clone button on private question', () => {
      const perms = computeRowPermissions({
        role: 'student',
        currentUserId: STUDENT_ID,
        item: {
          id: 'item-priv',
          author_id: TEACHER_A_ID,
          status: 'draft',
          visibility: 'private'
        }
      });
      assert.equal(perms.canClone, false);
    });
  });

  await t.test('4. REGRESSION VERIFICATION: OTHER BUTTONS INTEGRITY', async (t2) => {
    await t2.test('4.1. canDelete rules preserved for all roles', () => {
      // Admin can delete own and foreign
      assert.equal(computeRowPermissions({ role: 'admin', currentUserId: ADMIN_ID, item: { author_id: ADMIN_ID, status: 'published', visibility: 'private' } }).canDelete, true);
      assert.equal(computeRowPermissions({ role: 'admin', currentUserId: ADMIN_ID, item: { author_id: TEACHER_A_ID, status: 'published', visibility: 'private' } }).canDelete, true);
      // Teacher can delete own, but not shared
      assert.equal(computeRowPermissions({ role: 'teacher', currentUserId: TEACHER_A_ID, item: { author_id: TEACHER_A_ID, status: 'published', visibility: 'private' } }).canDelete, true);
      assert.equal(computeRowPermissions({ role: 'teacher', currentUserId: TEACHER_B_ID, item: { author_id: TEACHER_A_ID, status: 'published', visibility: 'public_template' } }).canDelete, false);
    });

    await t2.test('4.2. canPublish rules preserved (draft only)', () => {
      assert.equal(computeRowPermissions({ role: 'admin', currentUserId: ADMIN_ID, item: { author_id: TEACHER_A_ID, status: 'draft', visibility: 'private' } }).canPublish, true);
      assert.equal(computeRowPermissions({ role: 'admin', currentUserId: ADMIN_ID, item: { author_id: TEACHER_A_ID, status: 'published', visibility: 'private' } }).canPublish, false);
      assert.equal(computeRowPermissions({ role: 'teacher', currentUserId: TEACHER_A_ID, item: { author_id: TEACHER_A_ID, status: 'draft', visibility: 'private' } }).canPublish, true);
      assert.equal(computeRowPermissions({ role: 'teacher', currentUserId: TEACHER_B_ID, item: { author_id: TEACHER_A_ID, status: 'draft', visibility: 'private' } }).canPublish, false);
    });

    await t2.test('4.3. canArchive and canRestore toggle cleanly with isArchived', () => {
      const activeItem = { author_id: TEACHER_A_ID, status: 'published', visibility: 'private' };
      const archivedItem = { author_id: TEACHER_A_ID, status: 'archived', visibility: 'private' };

      const activePerms = computeRowPermissions({ role: 'admin', currentUserId: ADMIN_ID, item: activeItem });
      assert.equal(activePerms.canArchive, true);
      assert.equal(activePerms.canRestore, false);

      const archivedPerms = computeRowPermissions({ role: 'admin', currentUserId: ADMIN_ID, item: archivedItem });
      assert.equal(archivedPerms.canArchive, false);
      assert.equal(archivedPerms.canRestore, true);
    });
  });
});

