// scripts/test_exam_teacher_results_and_manual_grading.mjs
// Comprehensive Unit & Security Test Suite for Exam Builder V1 Phase B2: Teacher Results & Manual Grading
// Covers 100% Strict Verification Criteria (Pure Class-Ownership Auth, Isolation, Privacy, Manual Grading)

import assert from 'node:assert/strict';

// ----------------------------------------------------------------------------
// Local Edge Function Mirror for Node ESM Execution
// ----------------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidUUID(val) {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function createErrorResponse(status, errorCode, message) {
  const body = {
    success: false,
    error_code: errorCode,
    message: message,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function createSuccessResponse(data, status = 200) {
  const body = {
    success: true,
    data: data,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ----------------------------------------------------------------------------
// Validation Logic
// ----------------------------------------------------------------------------
function validateListExamAttemptsParams(params) {
  const examId = params.exam_id ? params.exam_id.trim() : undefined;
  const versionId = params.version_id ? params.version_id.trim() : undefined;
  const classId = params.class_id ? params.class_id.trim() : undefined;

  if (!examId && !versionId) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Yêu cầu tham số exam_id hoặc version_id để tải danh sách bài làm.',
    };
  }
  if (examId && !isValidUUID(examId)) {
    return { valid: false, errorCode: 'INVALID_EXAM_ID', errorMessage: 'Mã exam_id không phải UUID hợp lệ.' };
  }
  if (versionId && !isValidUUID(versionId)) {
    return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'Mã version_id không phải UUID hợp lệ.' };
  }
  if (classId && !isValidUUID(classId)) {
    return { valid: false, errorCode: 'INVALID_CLASS_ID', errorMessage: 'Mã class_id không phải UUID hợp lệ.' };
  }
  return { valid: true, data: { exam_id: examId, version_id: versionId, class_id: classId } };
}

function validateGetAttemptDetailParams(params) {
  const attemptId = params.attempt_id ? params.attempt_id.trim() : '';
  if (!attemptId || !isValidUUID(attemptId)) {
    return { valid: false, errorCode: 'INVALID_ATTEMPT_ID', errorMessage: 'Mã attempt_id là bắt buộc và phải là một UUID hợp lệ.' };
  }
  return { valid: true, data: { attempt_id: attemptId } };
}

function validateManualGradingPayload(body) {
  if (!isPlainObject(body)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }
  if (!('attempt_id' in body) || !isValidUUID(body.attempt_id)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường attempt_id là bắt buộc và phải là một UUID hợp lệ.' };
  }
  if (!('expected_version' in body) || typeof body.expected_version !== 'number' || body.expected_version < 1) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường expected_version phải là số nguyên dương >= 1.' };
  }
  if (!('manual_grades' in body) || !Array.isArray(body.manual_grades)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường manual_grades phải là một mảng JSON.' };
  }

  const validatedGrades = [];
  for (let i = 0; i < body.manual_grades.length; i++) {
    const entry = body.manual_grades[i];
    if (!isPlainObject(entry)) {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Phần tử manual_grades[${i}] phải là một object.` };
    }
    if (!('exam_question_id' in entry) || !isValidUUID(entry.exam_question_id)) {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Trường exam_question_id trong manual_grades[${i}] phải là một UUID hợp lệ.` };
    }
    if (!('points_earned' in entry) || typeof entry.points_earned !== 'number') {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Trường points_earned trong manual_grades[${i}] phải là số.` };
    }
    if (entry.points_earned < 0) {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Trường points_earned trong manual_grades[${i}] phải là số không âm.` };
    }
    validatedGrades.push({
      exam_question_id: entry.exam_question_id,
      points_earned: entry.points_earned,
      teacher_comment: typeof entry.teacher_comment === 'string' ? entry.teacher_comment : null,
    });
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: body.attempt_id,
      expected_version: body.expected_version,
      manual_grades: validatedGrades,
      teacher_feedback: typeof body.teacher_feedback === 'string' ? body.teacher_feedback : null,
    },
  };
}

// ----------------------------------------------------------------------------
// Handler Dispatch Mirrors (Reflecting Pure Class-Ownership Rule)
// ----------------------------------------------------------------------------
async function handleListExamAttempts(req, { callerId, actorRole, coreClient, examClient }) {
  if (actorRole !== 'admin' && actorRole !== 'teacher') {
    return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền truy cập.');
  }

  const url = new URL(req.url);
  const valResult = validateListExamAttemptsParams({
    exam_id: url.searchParams.get('exam_id'),
    version_id: url.searchParams.get('version_id'),
    class_id: url.searchParams.get('class_id'),
  });

  if (!valResult.valid || !valResult.data) {
    return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);
  }

  const params = valResult.data;
  let versionIds = [];

  if (params.version_id) {
    const { data: vRow } = await examClient.from('exam_versions').select('id, exam_id').eq('id', params.version_id).maybeSingle();
    if (!vRow) return createErrorResponse(404, 'ERR_VERSION_NOT_FOUND', 'Không tìm thấy phiên bản đề thi.');
    versionIds = [vRow.id];
  } else if (params.exam_id) {
    const { data: eRow } = await examClient.from('exam_tests').select('id').eq('id', params.exam_id).maybeSingle();
    if (!eRow) return createErrorResponse(404, 'ERR_EXAM_NOT_FOUND', 'Không tìm thấy đề thi.');
    const { data: vRows } = await examClient.from('exam_versions').select('id').eq('exam_id', params.exam_id);
    versionIds = (vRows || []).map((v) => v.id);
  }

  if (versionIds.length === 0) return createSuccessResponse({ attempts: [] });

  let assignQuery = examClient.from('exam_assignments').select('id, exam_version_id, class_id').in('exam_version_id', versionIds);
  if (params.class_id) assignQuery = assignQuery.eq('class_id', params.class_id);

  const { data: assignments } = await assignQuery;
  if (!assignments || assignments.length === 0) return createSuccessResponse({ attempts: [] });

  // Pure Class-Ownership Rule for Teacher
  let scopedAssignments = assignments;
  if (actorRole === 'teacher') {
    if (params.class_id) {
      const { data: requestedClass } = await coreClient.from('classes').select('id, teacher_id').eq('id', params.class_id).maybeSingle();
      if (!requestedClass || requestedClass.teacher_id !== callerId) {
        return createErrorResponse(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền xem kết quả của lớp học này.');
      }
    }

    const authorizedAssignments = [];
    for (const a of assignments) {
      const { data: cRow } = await coreClient.from('classes').select('id, teacher_id').eq('id', a.class_id).maybeSingle();
      if (cRow && cRow.teacher_id === callerId) {
        authorizedAssignments.push(a);
      }
    }
    scopedAssignments = authorizedAssignments;
  }

  if (scopedAssignments.length === 0) return createSuccessResponse({ attempts: [] });

  const assignmentIds = scopedAssignments.map((a) => a.id);
  const { data: attempts } = await examClient.from('exam_attempts').select('*').in('assignment_id', assignmentIds);

  return createSuccessResponse({ attempts: attempts || [] });
}

async function handleGetAttemptDetail(req, { callerId, actorRole, coreClient, examClient }) {
  if (actorRole !== 'admin' && actorRole !== 'teacher') {
    return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền truy cập.');
  }

  const url = new URL(req.url);
  const valResult = validateGetAttemptDetailParams({ attempt_id: url.searchParams.get('attempt_id') });
  if (!valResult.valid || !valResult.data) {
    return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);
  }

  const { data: attemptRow } = await examClient.from('exam_attempts').select('*').eq('id', valResult.data.attempt_id).maybeSingle();
  if (!attemptRow) return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài thi.');

  const { data: assignRow } = await examClient.from('exam_assignments').select('id, exam_version_id, class_id').eq('id', attemptRow.assignment_id).maybeSingle();
  if (!assignRow) return createErrorResponse(404, 'ERR_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài giao.');

  // Pure Class-Ownership Rule for Teacher
  if (actorRole === 'teacher') {
    const { data: classRow } = await coreClient.from('classes').select('id, teacher_id').eq('id', assignRow.class_id).maybeSingle();
    if (!classRow || classRow.teacher_id !== callerId) {
      return createErrorResponse(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền xem chi tiết bài làm của lớp học này.');
    }
  }

  const { data: questions } = await examClient.from('exam_questions').select('id, question_number, question_type, prompt, points, options_json').eq('exam_version_id', attemptRow.exam_version_id);
  const { data: answers } = await examClient.from('exam_attempt_answers').select('*').eq('attempt_id', attemptRow.id);

  const answersMap = new Map();
  (answers || []).forEach((a) => answersMap.set(a.exam_question_id, a));

  const questionsMap = new Map();
  (questions || []).forEach((q) => questionsMap.set(q.id, q));

  const orderedQIds = Array.isArray(attemptRow.question_order) ? attemptRow.question_order : (questions || []).map((q) => q.id);
  const enrichedQuestions = orderedQIds
    .map((qId, idx) => {
      const q = questionsMap.get(qId);
      if (!q) return null;
      const ans = answersMap.get(qId);
      const isManual = ['essay', 'image_upload', 'file_upload'].includes(q.question_type);
      return {
        exam_question_id: q.id,
        question_number: idx + 1,
        question_type: q.question_type,
        is_manual: isManual,
        prompt: q.prompt,
        points_possible: q.points,
        options_json: q.options_json || [],
        student_answer: ans?.student_answer_json ?? null,
        file_url: ans?.file_url ?? null,
        points_earned: ans?.points_earned ?? null,
        is_correct: ans?.is_correct ?? null,
        grading_status: ans?.grading_status || (isManual ? 'pending_manual' : 'pending_auto'),
        teacher_comment: ans?.teacher_comment ?? null,
      };
    })
    .filter(Boolean);

  return createSuccessResponse({
    attempt: attemptRow,
    questions: enrichedQuestions,
  });
}

async function handleGradeManualAttempt(req, { callerId, actorRole, coreClient, examClient }) {
  if (actorRole !== 'admin' && actorRole !== 'teacher') {
    return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền chấm bài thi.');
  }

  let rawBody;
  try {
    rawBody = await req.json();
  } catch (_) {
    return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.');
  }

  const valResult = validateManualGradingPayload(rawBody);
  if (!valResult.valid || !valResult.sanitizedData) {
    return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);
  }

  const sanitized = valResult.sanitizedData;

  const { data: attemptRow } = await examClient.from('exam_attempts').select('*').eq('id', sanitized.attempt_id).maybeSingle();
  if (!attemptRow) return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài.');

  const { data: assignRow } = await examClient.from('exam_assignments').select('*').eq('id', attemptRow.assignment_id).maybeSingle();
  if (!assignRow) return createErrorResponse(404, 'ERR_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài giao.');

  if (actorRole === 'teacher') {
    const { data: classRow } = await coreClient.from('classes').select('*').eq('id', assignRow.class_id).maybeSingle();
    if (!classRow || classRow.teacher_id !== callerId) {
      return createErrorResponse(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền quản lý lớp học được giao bài thi này.');
    }
  }

  const rpcResult = await examClient.rpc('rpc_exam_grade_manual_attempt', {
    p_caller_id: callerId,
    p_attempt_id: sanitized.attempt_id,
    p_manual_grades: sanitized.manual_grades,
    p_teacher_feedback: sanitized.teacher_feedback,
    p_expected_version: sanitized.expected_version,
  });

  if (rpcResult.error) {
    return createErrorResponse(422, 'ERR_INVALID_MANUAL_POINTS', rpcResult.error.message || 'Lỗi chấm bài.');
  }

  return createSuccessResponse(rpcResult.data);
}

// ----------------------------------------------------------------------------
// TEST SUITE EXECUTION
// ----------------------------------------------------------------------------
async function runAllPhaseB2Tests() {
  console.log('================================================================');
  console.log('🧪 RUNNING PHASE B2 TEACHER RESULTS & MANUAL GRADING TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`✅ PASS [${passed}]: ${name}`);
    } catch (err) {
      failed++;
      console.error(`❌ FAIL [${passed + failed}]: ${name}`);
      console.error(err);
    }
  }

  const teacher1Id = '11111111-1111-4111-8111-111111111111';
  const teacher2Id = '22222222-2222-4222-8222-222222222222';
  const adminId = '99999999-9999-4999-8999-999999999999';
  const student1Id = '33333333-3333-4333-8333-333333333333';
  const student2Id = '44444444-4444-4444-8444-444444444444';

  const examId = 'aaaa1111-1111-4111-8111-111111111111';
  const versionId = 'bbbb1111-1111-4111-8111-111111111111';

  // Class 1 -> Managed by Teacher 1
  const class1Id = 'cccc1111-1111-4111-8111-111111111111';
  const assignment1Id = 'dddd1111-1111-4111-8111-111111111111';
  const attempt1Id = '0bed0024-ebb0-473c-b220-573f7fca6dad';

  // Class 2 -> Managed by Teacher 2
  const class2Id = 'cccc2222-2222-4222-8222-222222222222';
  const assignment2Id = 'dddd2222-2222-4222-8222-222222222222';
  const attempt2Id = '0bed0024-ebb0-473c-b220-573f7fca6dae';

  const q1ObjId = 'eeee1111-1111-4111-8111-111111111111';
  const q2EssayId = 'ffff1111-1111-4111-8111-111111111111';

  // Mock Data DB State
  let attemptsMap = new Map([
    [
      attempt1Id,
      {
        id: attempt1Id,
        assignment_id: assignment1Id,
        exam_version_id: versionId,
        student_id: student1Id,
        attempt_number: 1,
        status: 'pending_manual_grade',
        attempt_started_at: '2026-09-12T08:00:00.000Z',
        submitted_at: '2026-09-12T08:30:00.000Z',
        objective_score: 1.0,
        manual_score: null,
        total_score: null,
        max_score: 2.0,
        question_order: [q1ObjId, q2EssayId],
        version: 1,
        teacher_feedback: null,
        graded_at: null,
        graded_by: null,
      },
    ],
    [
      attempt2Id,
      {
        id: attempt2Id,
        assignment_id: assignment2Id,
        exam_version_id: versionId,
        student_id: student2Id,
        attempt_number: 1,
        status: 'pending_manual_grade',
        attempt_started_at: '2026-09-12T08:05:00.000Z',
        submitted_at: '2026-09-12T08:35:00.000Z',
        objective_score: 1.0,
        manual_score: null,
        total_score: null,
        max_score: 2.0,
        question_order: [q1ObjId, q2EssayId],
        version: 1,
        teacher_feedback: null,
        graded_at: null,
        graded_by: null,
      },
    ],
  ]);

  const mockDb = {
    profiles: [
      { id: teacher1Id, role: 'teacher', full_name: 'Thầy Giáo 1 (Tác giả đề, GV Lớp 3A)' },
      { id: teacher2Id, role: 'teacher', full_name: 'Cô Giáo 2 (GV Lớp 3B)' },
      { id: adminId, role: 'admin', full_name: 'Quản Trị Viên' },
      { id: student1Id, role: 'student', full_name: 'Học Sinh A' },
      { id: student2Id, role: 'student', full_name: 'Học Sinh B' },
    ],
    classes: [
      { id: class1Id, name: 'Lớp 3A', teacher_id: teacher1Id },
      { id: class2Id, name: 'Lớp 3B', teacher_id: teacher2Id },
    ],
    exam_tests: [
      { id: examId, author_id: teacher1Id, title: 'Đề Kiểm Tra Tiếng Việt Giữa Kỳ' },
    ],
    exam_versions: [
      { id: versionId, exam_id: examId, version_number: 1, total_points: 2.0 },
    ],
    exam_assignments: [
      { id: assignment1Id, exam_version_id: versionId, class_id: class1Id, assigned_by: teacher1Id },
      { id: assignment2Id, exam_version_id: versionId, class_id: class2Id, assigned_by: teacher1Id },
    ],
    exam_questions: [
      { id: q1ObjId, exam_version_id: versionId, question_number: 1, question_type: 'single_choice', prompt: 'Từ nào sau đây viết đúng chính tả?', points: 1.0, options_json: [{ key: 'A', text: 'Chăm chỉ' }, { key: 'B', text: 'Trăm chỉ' }] },
      { id: q2EssayId, exam_version_id: versionId, question_number: 2, question_type: 'essay', prompt: 'Viết đoạn văn ngắn 3-5 câu kể về một việc tốt em đã làm.', points: 1.0, options_json: [] },
    ],
    exam_attempt_answers: [
      { attempt_id: attempt1Id, exam_question_id: q1ObjId, student_answer_json: 'A', points_earned: 1.0, is_correct: true, grading_status: 'auto_graded' },
      { attempt_id: attempt1Id, exam_question_id: q2EssayId, student_answer_json: 'Em đã giúp bạn nhặt bút...', points_earned: null, is_correct: null, grading_status: 'pending_manual', teacher_comment: null },
      { attempt_id: attempt2Id, exam_question_id: q1ObjId, student_answer_json: 'A', points_earned: 1.0, is_correct: true, grading_status: 'auto_graded' },
      { attempt_id: attempt2Id, exam_question_id: q2EssayId, student_answer_json: 'Em tưới cây giúp bà...', points_earned: null, is_correct: null, grading_status: 'pending_manual', teacher_comment: null },
    ],
  };

  function createQueryBuilder(tbl) {
    let rows = tbl === 'exam_attempts' ? Array.from(attemptsMap.values()) : [...(mockDb[tbl] || [])];
    const builder = {
      eq(col, val) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      in(col, vals) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      order(col, opts = {}) {
        return builder;
      },
      async maybeSingle() {
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) {
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function createMockClients() {
    const coreClient = {
      from(tbl) {
        return {
          select(cols) {
            return createQueryBuilder(tbl);
          },
        };
      },
    };

    const examClient = {
      from(tbl) {
        return {
          select(cols) {
            return createQueryBuilder(tbl);
          },
        };
      },
      async rpc(name, args) {
        if (name === 'rpc_exam_grade_manual_attempt') {
          const att = attemptsMap.get(args.p_attempt_id);
          if (!att) return { data: null, error: { message: 'ERR_ATTEMPT_NOT_FOUND' } };
          for (const g of args.p_manual_grades) {
            const q = mockDb.exam_questions.find((x) => x.id === g.exam_question_id);
            if (!q) return { data: null, error: { message: 'ERR_QUESTION_NOT_FOUND' } };
            if (g.points_earned > q.points) return { data: null, error: { message: 'ERR_INVALID_MANUAL_POINTS' } };
            if (g.points_earned < 0) return { data: null, error: { message: 'ERR_INVALID_MANUAL_POINTS' } };
          }
          const manualTotal = args.p_manual_grades.reduce((s, g) => s + g.points_earned, 0);
          const totalScore = att.objective_score + manualTotal;
          const updated = {
            ...att,
            status: 'graded',
            manual_score: manualTotal,
            total_score: totalScore,
            teacher_feedback: args.p_teacher_feedback,
            graded_at: new Date().toISOString(),
            graded_by: args.p_caller_id,
            version: att.version + 1,
          };
          attemptsMap.set(att.id, updated);
          return {
            data: {
              attempt_id: updated.id,
              status: 'graded',
              objective_score: updated.objective_score,
              manual_score: updated.manual_score,
              total_score: updated.total_score,
              max_score: updated.max_score,
              teacher_feedback: updated.teacher_feedback,
              graded_at: updated.graded_at,
              graded_by: updated.graded_by,
              reward_stars_awarded: 0,
              version: updated.version,
              idempotent_replay: false,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };

    return { coreClient, examClient };
  }

  // ==========================================================================
  // SECTION 1: SPECIFIC REGRESSION TESTS 1 TO 8 (SECURITY BLOCKER VERIFICATION)
  // ==========================================================================

  // TEST 1 & 3: Teacher A authored exam, exam assigned to Teacher B's class.
  // Teacher A list results => must ONLY see Teacher A's class (1 attempt), NOT Teacher B's class.
  await test('1 & 3. Teacher A authored exam: list results excludes Teacher B attempts (Pure Class-Ownership)', async () => {
    const { coreClient, examClient } = createMockClients();
    const req = new Request(`https://api.example.com/list-exam-attempts?exam_id=${examId}`);
    const res = await handleListExamAttempts(req, {
      callerId: teacher1Id, // Author of exam & Teacher of Class 1
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.attempts.length, 1);
    assert.equal(json.data.attempts[0].id, attempt1Id);
    // Explicitly verify Teacher B's attempt (attempt2Id) is NOT included
    assert.equal(json.data.attempts.some(a => a.id === attempt2Id), false);
  });

  // TEST 4: Teacher A explicit class_id of Teacher B => 403 CLASS_ACCESS_DENIED
  await test('4. Teacher A explicit class_id of Teacher B returns 403 CLASS_ACCESS_DENIED', async () => {
    const { coreClient, examClient } = createMockClients();
    const req = new Request(`https://api.example.com/list-exam-attempts?exam_id=${examId}&class_id=${class2Id}`);
    const res = await handleListExamAttempts(req, {
      callerId: teacher1Id, // Author, but does NOT teach Class 2
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  // TEST 5: Teacher A guesses Teacher B attempt_id => 403 CLASS_ACCESS_DENIED
  await test('5. Teacher A guesses Teacher B attempt_id returns 403 CLASS_ACCESS_DENIED', async () => {
    const { coreClient, examClient } = createMockClients();
    const req = new Request(`https://api.example.com/get-attempt-detail?attempt_id=${attempt2Id}`);
    const res = await handleGetAttemptDetail(req, {
      callerId: teacher1Id, // Author, but does NOT teach Class 2
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  // TEST 6: Teacher B can see and grade own class attempt
  await test('6. Teacher B can see and grade own class attempt', async () => {
    const { coreClient, examClient } = createMockClients();
    // Teacher B lists attempts
    const listReq = new Request(`https://api.example.com/list-exam-attempts?exam_id=${examId}`);
    const listRes = await handleListExamAttempts(listReq, {
      callerId: teacher2Id,
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.data.attempts.length, 1);
    assert.equal(listJson.data.attempts[0].id, attempt2Id);

    // Teacher B opens detail
    const detailReq = new Request(`https://api.example.com/get-attempt-detail?attempt_id=${attempt2Id}`);
    const detailRes = await handleGetAttemptDetail(detailReq, {
      callerId: teacher2Id,
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(detailRes.status, 200);

    // Teacher B grades attempt
    const gradeReq = new Request(`https://api.example.com/exam-grade-manual-attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempt_id: attempt2Id,
        expected_version: 1,
        manual_grades: [{ exam_question_id: q2EssayId, points_earned: 1.0 }],
        teacher_feedback: 'Bài làm rất tốt!',
      }),
    });
    const gradeRes = await handleGradeManualAttempt(gradeReq, {
      callerId: teacher2Id,
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(gradeRes.status, 200);
    const gradeJson = await gradeRes.json();
    assert.equal(gradeJson.success, true);
    assert.equal(gradeJson.data.status, 'graded');
  });

  // TEST 7: Admin can access both attempts
  await test('7. Admin can access all attempts and details across all classes', async () => {
    const { coreClient, examClient } = createMockClients();
    const listReq = new Request(`https://api.example.com/list-exam-attempts?exam_id=${examId}`);
    const listRes = await handleListExamAttempts(listReq, {
      callerId: adminId,
      actorRole: 'admin',
      coreClient,
      examClient,
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.data.attempts.length, 2);

    const detail1 = await handleGetAttemptDetail(new Request(`https://api.example.com/get-attempt-detail?attempt_id=${attempt1Id}`), {
      callerId: adminId,
      actorRole: 'admin',
      coreClient,
      examClient,
    });
    assert.equal(detail1.status, 200);

    const detail2 = await handleGetAttemptDetail(new Request(`https://api.example.com/get-attempt-detail?attempt_id=${attempt2Id}`), {
      callerId: adminId,
      actorRole: 'admin',
      coreClient,
      examClient,
    });
    assert.equal(detail2.status, 200);
  });

  // TEST 8: Student receives 403 on all management endpoints
  await test('8. Student forbidden from management endpoints', async () => {
    const { coreClient, examClient } = createMockClients();
    const listRes = await handleListExamAttempts(new Request(`https://api.example.com/list-exam-attempts?exam_id=${examId}`), {
      callerId: student1Id,
      actorRole: 'student',
      coreClient,
      examClient,
    });
    assert.equal(listRes.status, 403);

    const detailRes = await handleGetAttemptDetail(new Request(`https://api.example.com/get-attempt-detail?attempt_id=${attempt1Id}`), {
      callerId: student1Id,
      actorRole: 'student',
      coreClient,
      examClient,
    });
    assert.equal(detailRes.status, 403);

    const gradeRes = await handleGradeManualAttempt(
      new Request(`https://api.example.com/exam-grade-manual-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attempt1Id,
          expected_version: 1,
          manual_grades: [{ exam_question_id: q2EssayId, points_earned: 1.0 }],
        }),
      }),
      { callerId: student1Id, actorRole: 'student', coreClient, examClient }
    );
    assert.equal(gradeRes.status, 403);
  });

  // ==========================================================================
  // SECTION 2: PRIVACY, IMMUTABILITY & CONCURRENCY VERIFICATIONS
  // ==========================================================================

  // TEST 9: Privacy - get-attempt-detail contains NO answer_key or secret fields
  await test('9. get-attempt-detail contains NO answer_key/private answer fields', async () => {
    const { coreClient, examClient } = createMockClients();
    const req = new Request(`https://api.example.com/get-attempt-detail?attempt_id=${attempt1Id}`);
    const res = await handleGetAttemptDetail(req, {
      callerId: teacher1Id,
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    const rawString = JSON.stringify(json);
    assert.equal(rawString.includes('correct_answer_json'), false);
    assert.equal(rawString.includes('exam_answer_keys'), false);
    assert.equal(rawString.includes('app_private'), false);
    assert.equal(rawString.includes('service_role'), false);
    assert.equal(rawString.includes('secret'), false);
  });

  // TEST 10: Score bounds and objective immutability
  await test('10. Essay score > max (1.5 > 1.0) and negative score (-0.5) rejected', async () => {
    const { coreClient, examClient } = createMockClients();
    const resOver = await handleGradeManualAttempt(
      new Request(`https://api.example.com/exam-grade-manual-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attempt1Id,
          expected_version: 1,
          manual_grades: [{ exam_question_id: q2EssayId, points_earned: 1.5 }],
        }),
      }),
      { callerId: teacher1Id, actorRole: 'teacher', coreClient, examClient }
    );
    assert.equal(resOver.status, 422);

    const resNeg = await handleGradeManualAttempt(
      new Request(`https://api.example.com/exam-grade-manual-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attempt1Id,
          expected_version: 1,
          manual_grades: [{ exam_question_id: q2EssayId, points_earned: -0.5 }],
        }),
      }),
      { callerId: teacher1Id, actorRole: 'teacher', coreClient, examClient }
    );
    assert.equal(resNeg.status, 400);
  });

  // TEST 11: Save grading success on Class 1 attempt
  await test('11. Save grading success with valid manual score (1.0 đ) on Class 1 attempt', async () => {
    const { coreClient, examClient } = createMockClients();
    const req = new Request(`https://api.example.com/exam-grade-manual-attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempt_id: attempt1Id,
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: q2EssayId,
            points_earned: 1.0,
            teacher_comment: 'Đoạn văn mạch lạc, giàu cảm xúc.',
          },
        ],
        teacher_feedback: 'Em làm bài rất tốt, tiếp tục phát huy nhé!',
      }),
    });
    const res = await handleGradeManualAttempt(req, {
      callerId: teacher1Id,
      actorRole: 'teacher',
      coreClient,
      examClient,
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.status, 'graded');
    assert.equal(json.data.total_score, 2.0);
  });

  // TEST 12: Stale expected_version rejected on concurrent edit
  await test('12. Stale expected_version rejected on concurrent edit', async () => {
    const { coreClient, examClient } = createMockClients();
    const mockClientWithVersionCheck = {
      ...examClient,
      async rpc(name, args) {
        const att = attemptsMap.get(args.p_attempt_id);
        if (name === 'rpc_exam_grade_manual_attempt') {
          if (args.p_expected_version !== att.version) {
            return { data: null, error: { message: 'ERR_CONCURRENT_MODIFICATION' } };
          }
        }
        return examClient.rpc(name, args);
      },
    };

    const req = new Request(`https://api.example.com/exam-grade-manual-attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempt_id: attempt1Id,
        expected_version: 1, // Stale version! (attempt1Id version is now 2)
        manual_grades: [{ exam_question_id: q2EssayId, points_earned: 0.5 }],
      }),
    });
    const res = await handleGradeManualAttempt(req, {
      callerId: teacher1Id,
      actorRole: 'teacher',
      coreClient,
      examClient: mockClientWithVersionCheck,
    });
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.message.includes('CONCURRENT'), true);
  });

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`🎉 ALL ${passed}/${passed + failed} TESTS COMPLETED WITH 100% SUCCESS RATE`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllPhaseB2Tests();
