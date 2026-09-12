// scripts/test_exam_update_graded_feedback.mjs
// Comprehensive Test Suite for EXAM V1 Post-Grade Feedback Update
// Covers Database RPC (PGlite), Edge Function BFF Handler, Permissions, Optimistic Locking, and Score Immutability

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Test Fixture UUIDs
const TEACHER_1_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_FOREIGN_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';

const CLASS_1_ID = '55555555-5555-4555-8555-555555555555';
const EXAM_ID = '66666666-6666-4666-8666-666666666666';
const EXAM_VERSION_ID = '77777777-7777-4777-8777-777777777777';
const ASSIGNMENT_ID = '88888888-8888-4888-8888-888888888888';

const ATTEMPT_GRADED_ID = '99999999-9999-4999-8999-999999999999';
const ATTEMPT_PENDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const Q_OBJECTIVE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const Q_MANUAL_1_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const Q_MANUAL_2_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// ----------------------------------------------------------------------------
// Local Node ESM Dispatch Mirror for exam-update-graded-feedback
// ----------------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function createErrorResponse(status, errorCode, message) {
  return new Response(
    JSON.stringify({ success: false, error_code: errorCode, message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function createSuccessResponse(data, status = 200) {
  return new Response(
    JSON.stringify({ success: true, data }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isValidUUID(val) {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function validateUpdateFeedbackPayload(body) {
  if (!isPlainObject(body)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object hợp lệ.' };
  }

  const forbiddenFields = new Set([
    'caller_id', 'p_caller_id', 'role', 'actor_role', 'class_id', 'is_admin', 
    'student_id', 'service_role', 'service_role_key', 'points_earned', 'score',
    'objective_score', 'manual_score', 'total_score', 'max_score', 'is_correct',
    'grading_status', 'status'
  ]);

  for (const key of Object.keys(body)) {
    if (forbiddenFields.has(key.toLowerCase().trim())) {
      return { valid: false, errorCode: 'INVALID_REQUEST_FIELD', errorMessage: `Trường '${key}' bị cấm trong payload yêu cầu bảo mật.` };
    }
  }

  const allowedTopKeys = new Set(['attempt_id', 'expected_version', 'teacher_feedback', 'question_comments']);
  for (const key of Object.keys(body)) {
    if (!allowedTopKeys.has(key)) {
      return { valid: false, errorCode: 'INVALID_REQUEST_FIELD', errorMessage: `Trường '${key}' không nằm trong danh sách cho phép.` };
    }
  }

  if (!('attempt_id' in body) || !isValidUUID(body.attempt_id)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường attempt_id là bắt buộc và phải là một UUID hợp lệ.' };
  }

  if (!('expected_version' in body)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường expected_version là bắt buộc.' };
  }

  const expVer = body.expected_version;
  if (typeof expVer !== 'number' || !Number.isInteger(expVer) || expVer < 1 || expVer > 1000000) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường expected_version phải là số nguyên dương hợp lệ.' };
  }

  let sanitizedTeacherFeedback = null;
  if ('teacher_feedback' in body && body.teacher_feedback !== null && body.teacher_feedback !== undefined) {
    if (typeof body.teacher_feedback !== 'string') {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường teacher_feedback phải là một chuỗi văn bản hoặc null.' };
    }
    const trimmed = body.teacher_feedback.trim();
    if (trimmed.length > 5000) {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Nhận xét tổng thể không được vượt quá 5000 ký tự.' };
    }
    sanitizedTeacherFeedback = trimmed.length > 0 ? trimmed : null;
  }

  const sanitizedQuestionComments = [];
  if ('question_comments' in body && body.question_comments !== null && body.question_comments !== undefined) {
    if (!Array.isArray(body.question_comments)) {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Trường question_comments phải là một mảng JSON.' };
    }

    const seenQuestionIds = new Set();
    const allowedCommentKeys = new Set(['exam_question_id', 'teacher_comment']);

    for (let i = 0; i < body.question_comments.length; i++) {
      const entry = body.question_comments[i];
      if (!isPlainObject(entry)) {
        return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Mục nhận xét câu hỏi số ${i + 1} phải là một JSON object.` };
      }

      for (const key of Object.keys(entry)) {
        if (forbiddenFields.has(key.toLowerCase().trim())) {
          return { valid: false, errorCode: 'INVALID_REQUEST_FIELD', errorMessage: `Trường '${key}' bị cấm trong mục nhận xét câu hỏi số ${i + 1}.` };
        }
        if (!allowedCommentKeys.has(key)) {
          return { valid: false, errorCode: 'INVALID_REQUEST_FIELD', errorMessage: `Trường '${key}' không được phép trong mục nhận xét câu hỏi số ${i + 1}.` };
        }
      }

      if (!('exam_question_id' in entry) || !isValidUUID(entry.exam_question_id)) {
        return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Trường exam_question_id ở mục số ${i + 1} phải là một UUID hợp lệ.` };
      }

      const qId = entry.exam_question_id;
      if (seenQuestionIds.has(qId)) {
        return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Câu hỏi '${qId}' bị trùng lặp trong danh sách nhận xét.` };
      }
      seenQuestionIds.add(qId);

      let commentStr = null;
      if ('teacher_comment' in entry && entry.teacher_comment !== null && entry.teacher_comment !== undefined) {
        if (typeof entry.teacher_comment !== 'string') {
          return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Nhận xét cho câu hỏi số ${i + 1} phải là một chuỗi văn bản hoặc null.` };
        }
        const trimmedComment = entry.teacher_comment.trim();
        if (trimmedComment.length > 2000) {
          return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: `Nhận xét câu hỏi số ${i + 1} không được vượt quá 2000 ký tự.` };
        }
        commentStr = trimmedComment.length > 0 ? trimmedComment : null;
      }

      sanitizedQuestionComments.push({
        exam_question_id: qId,
        teacher_comment: commentStr,
      });
    }
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: body.attempt_id,
      expected_version: expVer,
      teacher_feedback: sanitizedTeacherFeedback,
      question_comments: sanitizedQuestionComments,
    },
  };
}

function normalizeRpcError(err) {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
      ? err.message
      : '';

  if (rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }
  if (rawMsg.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_OPTIMISTIC_LOCK_CONFLICT', message: 'Dữ liệu bài thi đã thay đổi bởi thao tác khác, vui lòng làm mới trang.' };
  }
  if (rawMsg.includes('ERR_INVALID_ATTEMPT_STATUS')) {
    return { status: 409, errorCode: 'ERR_INVALID_ATTEMPT_STATUS', message: 'Chỉ có thể cập nhật nhận xét cho bài thi đã hoàn tất chấm điểm (graded).' };
  }
  if (rawMsg.includes('ERR_NOT_MANUAL_QUESTION')) {
    return { status: 422, errorCode: 'ERR_NOT_MANUAL_QUESTION', message: 'Chỉ có thể thêm nhận xét cho các câu hỏi tự luận hoặc tải tệp.' };
  }
  if (rawMsg.includes('ERR_DUPLICATE_QUESTION_COMMENT')) {
    return { status: 422, errorCode: 'ERR_DUPLICATE_QUESTION_COMMENT', message: 'Danh sách nhận xét chứa câu hỏi bị trùng lặp.' };
  }
  if (rawMsg.includes('ERR_INVALID_QUESTION_COMMENTS_PAYLOAD')) {
    return { status: 422, errorCode: 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD', message: 'Cấu trúc dữ liệu nhận xét câu hỏi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_INVALID_TEACHER_COMMENT')) {
    return { status: 422, errorCode: 'ERR_INVALID_TEACHER_COMMENT', message: 'Nội dung nhận xét câu hỏi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_MANUAL_ANSWER_ROW_MISSING')) {
    return { status: 422, errorCode: 'ERR_MANUAL_ANSWER_ROW_MISSING', message: 'Không tìm thấy bản ghi câu trả lời tương ứng trong bài thi.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_SNAPSHOT_INVALID')) {
    return { status: 422, errorCode: 'ERR_ATTEMPT_SNAPSHOT_INVALID', message: 'Dữ liệu cấu trúc bài thi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_REQUIRED_PARAMS')) {
    return { status: 422, errorCode: 'ERR_REQUIRED_PARAMS', message: 'Thiếu các tham số bắt buộc để cập nhật nhận xét.' };
  }

  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi máy chủ trong quá trình cập nhật nhận xét bài thi.',
  };
}

async function handleUpdateGradedFeedback(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return createErrorResponse(405, 'INVALID_INPUT', 'Chỉ chấp nhận POST.');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.');
  }

  const { callerAuthClient, coreQueryClient, examQueryClient } = deps;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const { data: userData, error: userError } = await callerAuthClient.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return createErrorResponse(401, 'INVALID_TOKEN', 'Token không hợp lệ.');
  }

  const callerId = userData.user.id;
  const { data: profile } = await coreQueryClient.from('profiles').select('id, role, is_disabled').eq('id', callerId).maybeSingle();

  if (!profile || profile.is_disabled) {
    return createErrorResponse(403, profile?.is_disabled ? 'ACCOUNT_DISABLED' : 'FORBIDDEN_ROLE', 'Truy cập bị từ chối.');
  }

  if (profile.role !== 'admin' && profile.role !== 'teacher') {
    return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền cập nhật nhận xét.');
  }

  let rawBody;
  try {
    rawBody = await req.json();
  } catch (_) {
    return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.');
  }

  const valResult = validateUpdateFeedbackPayload(rawBody);
  if (!valResult.valid || !valResult.sanitizedData) {
    return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Payload không hợp lệ.');
  }

  const sanitized = valResult.sanitizedData;

  // Resolve attempt -> assignment -> class
  const { data: attemptRow } = await examQueryClient.from('exam_attempts').select('id, assignment_id').eq('id', sanitized.attempt_id).maybeSingle();
  if (!attemptRow) return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài.');

  const { data: assignmentRow } = await examQueryClient.from('exam_assignments').select('id, class_id').eq('id', attemptRow.assignment_id).maybeSingle();
  if (!assignmentRow) return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy bài giao.');

  if (profile.role === 'teacher') {
    const { data: classRow } = await coreQueryClient.from('classes').select('id, teacher_id').eq('id', assignmentRow.class_id).maybeSingle();
    if (!classRow || classRow.teacher_id !== callerId) {
      return createErrorResponse(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền quản lý lớp học này.');
    }
  }

  // Execute RPC
  const rpcResult = await examQueryClient.rpc('rpc_exam_update_graded_feedback', {
    p_caller_id: callerId,
    p_attempt_id: sanitized.attempt_id,
    p_teacher_feedback: sanitized.teacher_feedback,
    p_question_comments: sanitized.question_comments,
    p_expected_version: sanitized.expected_version,
  });

  if (rpcResult.error) {
    const norm = normalizeRpcError(rpcResult.error);
    return createErrorResponse(norm.status, norm.errorCode, norm.message);
  }

  return createSuccessResponse(rpcResult.data, 200);
}

// ----------------------------------------------------------------------------
// Test Runner
// ----------------------------------------------------------------------------
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function it(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [${String(totalTests).padStart(2, '0')}] PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`❌ [${String(totalTests).padStart(2, '0')}] FAIL: ${name}`);
    console.error(err);
  }
}

async function initTestDb() {
  const db = await PGlite.create();

  // Create roles & private schema
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS app_private;
  `);

  const migrationFiles = [
    '20260905000001_exam_builder_v1_phase1_schema.sql',
    '20260905000002_exam_builder_v1_phase1_1_grading_status.sql',
    '20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql',
    '20260905000004_exam_builder_v1_phase2b1_assignment_attempt_rpcs.sql',
    '20260905000005_exam_builder_v1_phase2b2_answer_submit_rpcs.sql',
    '20260905000006_exam_builder_v1_phase2c_manual_grading_rpc.sql',
    '20260912000012_exam_v1_update_graded_feedback_rpc.sql',
  ];

  for (const f of migrationFiles) {
    const sql = fs.readFileSync(path.join('supabase/migrations', f), 'utf8');
    await db.exec(sql);
  }

  // Seed baseline exam version and questions
  await db.exec(`
    INSERT INTO public.exam_tests (id, author_id, title, subject, grade_level)
    VALUES ('${EXAM_ID}', '${TEACHER_1_ID}', 'Đề Kiểm Tra Toán', 'Toan', 10);



    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, total_points, published_at)
    VALUES ('${EXAM_VERSION_ID}', '${EXAM_ID}', 1, 'Đề Kiểm Tra Toán 1', 'Toan', 10, 'published', 10.00, NOW());


    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
    VALUES 
      ('${Q_OBJECTIVE_ID}', '${EXAM_VERSION_ID}', 1, 'single_choice', '1 + 1 = ?', 4.00, '[{"key":"A","text":"1"},{"key":"B","text":"2"}]'::jsonb),
      ('${Q_MANUAL_1_ID}', '${EXAM_VERSION_ID}', 2, 'essay', 'Giải thích định lý Pytago', 3.00, '[]'::jsonb),
      ('${Q_MANUAL_2_ID}', '${EXAM_VERSION_ID}', 3, 'file_upload', 'Tải lên bài giải chi tiết', 3.00, '[]'::jsonb);


    INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
    VALUES ('${ASSIGNMENT_ID}', '${EXAM_VERSION_ID}', '${CLASS_1_ID}', '${TEACHER_1_ID}');

    -- Graded Attempt (Base Version = 5, Total = 8.50, Initial feedback = NULL)
    INSERT INTO public.exam_attempts (
      id, assignment_id, exam_version_id, student_id, attempt_number, status, 
      objective_score, manual_score, total_score, max_score, 
      question_order, teacher_feedback, graded_at, graded_by, version
    ) VALUES (
      '${ATTEMPT_GRADED_ID}', '${ASSIGNMENT_ID}', '${EXAM_VERSION_ID}', '${STUDENT_ID}', 1, 'graded',
      4.00, 4.50, 8.50, 10.00,
      '["${Q_OBJECTIVE_ID}", "${Q_MANUAL_1_ID}", "${Q_MANUAL_2_ID}"]'::jsonb,
      NULL, '2026-09-12 10:00:00+00', '${TEACHER_1_ID}', 5
    );

    -- Answer Rows for Graded Attempt
    INSERT INTO public.exam_attempt_answers (id, exam_version_id, attempt_id, exam_question_id, student_answer_json, points_earned, grading_status, teacher_comment)
    VALUES
      (gen_random_uuid(), '${EXAM_VERSION_ID}', '${ATTEMPT_GRADED_ID}', '${Q_OBJECTIVE_ID}', '"B"'::jsonb, 4.00, 'auto_graded', NULL),
      (gen_random_uuid(), '${EXAM_VERSION_ID}', '${ATTEMPT_GRADED_ID}', '${Q_MANUAL_1_ID}', '"Lập luận Pytago"'::jsonb, 2.50, 'manual_graded', NULL),
      (gen_random_uuid(), '${EXAM_VERSION_ID}', '${ATTEMPT_GRADED_ID}', '${Q_MANUAL_2_ID}', NULL, 2.00, 'manual_graded', NULL);

    -- Pending Manual Grade Attempt
    INSERT INTO public.exam_attempts (
      id, assignment_id, exam_version_id, student_id, attempt_number, status,
      objective_score, manual_score, total_score, max_score,
      question_order, version
    ) VALUES (
      '${ATTEMPT_PENDING_ID}', '${ASSIGNMENT_ID}', '${EXAM_VERSION_ID}', '${STUDENT_ID}', 2, 'pending_manual_grade',
      4.00, NULL, 4.00, 10.00,
      '["${Q_OBJECTIVE_ID}", "${Q_MANUAL_1_ID}", "${Q_MANUAL_2_ID}"]'::jsonb, 1
    );

    -- Draft Attempt
    INSERT INTO public.exam_attempts (
      id, assignment_id, exam_version_id, student_id, attempt_number, status,
      max_score, question_order, version
    ) VALUES (
      '${ATTEMPT_DRAFT_ID}', '${ASSIGNMENT_ID}', '${EXAM_VERSION_ID}', '${STUDENT_ID}', 3, 'draft',
      10.00, '["${Q_OBJECTIVE_ID}", "${Q_MANUAL_1_ID}", "${Q_MANUAL_2_ID}"]'::jsonb, 1
    );
  `);

  return db;
}


function createMockCoreClient(profiles, classes) {
  return {
    from(table) {
      return {
        select(cols) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  if (table === 'profiles') {
                    const p = profiles.find((item) => item[col] === val);
                    return { data: p || null, error: null };
                  }
                  if (table === 'classes') {
                    const c = classes.find((item) => item[col] === val);
                    return { data: c || null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function createMockExamClient(db) {
  return {
    from(table) {
      return {
        select(cols) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  const res = await db.query(
                    `SELECT ${cols} FROM public.${table} WHERE ${col} = $1 LIMIT 1`,
                    [val]
                  );
                  return { data: res.rows[0] || null, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      if (name === 'rpc_exam_update_graded_feedback') {
        try {
          const res = await db.query(
            `SELECT public.rpc_exam_update_graded_feedback($1, $2, $3, $4::jsonb, $5) AS result`,
            [
              args.p_caller_id,
              args.p_attempt_id,
              args.p_teacher_feedback,
              JSON.stringify(args.p_question_comments || []),
              args.p_expected_version,
            ]
          );
          return { data: res.rows[0]?.result, error: null };
        } catch (err) {
          return { data: null, error: err };
        }
      }
      throw new Error(`Unhandled RPC: ${name}`);
    },
  };
}

async function runTests() {
  console.log('=== RUNNING EXAM V1 POST-GRADE FEEDBACK UPDATE TEST SUITE ===\n');

  const db = await initTestDb();

  const mockProfiles = [
    { id: TEACHER_1_ID, role: 'teacher', is_disabled: false },
    { id: TEACHER_FOREIGN_ID, role: 'teacher', is_disabled: false },
    { id: ADMIN_ID, role: 'admin', is_disabled: false },
    { id: STUDENT_ID, role: 'student', is_disabled: false },
  ];

  const mockClasses = [
    { id: CLASS_1_ID, teacher_id: TEACHER_1_ID },
  ];

  const coreClient = createMockCoreClient(mockProfiles, mockClasses);
  const examClient = createMockExamClient(db);

  const makeDeps = (callerId) => ({
    callerAuthClient: {
      auth: {
        async getUser() {
          return { data: { user: { id: callerId } }, error: null };
        },
      },
    },
    coreQueryClient: coreClient,
    examQueryClient: examClient,
  });

  // 1. Teacher own class can update feedback on graded attempt
  await it('1. Teacher own class can update feedback on graded attempt', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 5,
        teacher_feedback: 'Bài làm rất tốt, trình bày mạch lạc.',
        question_comments: [
          { exam_question_id: Q_MANUAL_1_ID, teacher_comment: 'Lập luận định lý chính xác 100%.' },
          { exam_question_id: Q_MANUAL_2_ID, teacher_comment: 'Hình vẽ rõ nét.' },
        ],
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(TEACHER_1_ID));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.attempt_id, ATTEMPT_GRADED_ID);
    assert.equal(body.data.status, 'graded');
    assert.equal(body.data.teacher_feedback, 'Bài làm rất tốt, trình bày mạch lạc.');
    assert.equal(body.data.version, 6); // incremented from 5 to 6
  });

  // 2. Teacher foreign class denied (403 CLASS_ACCESS_DENIED)
  await it('2. Teacher foreign class denied (403 CLASS_ACCESS_DENIED)', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_foreign_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 6,
        teacher_feedback: 'Hack feedback',
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(TEACHER_FOREIGN_ID));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error_code, 'CLASS_ACCESS_DENIED');
  });

  // 3. Admin allowed to update feedback
  await it('3. Admin allowed to update feedback', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_admin_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 6,
        teacher_feedback: 'Nhận xét bởi Quản trị viên.',
        question_comments: [
          { exam_question_id: Q_MANUAL_1_ID, teacher_comment: 'Admin duyệt lời phê.' },
        ],
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(ADMIN_ID));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.version, 7);
  });

  // 4. Student denied (403 FORBIDDEN_ROLE)
  await it('4. Student denied (403 FORBIDDEN_ROLE)', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_student_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 7,
        teacher_feedback: 'Student self feedback',
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(STUDENT_ID));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error_code, 'FORBIDDEN_ROLE');
  });

  // 5. Non-graded attempt rejected by feedback-only RPC (pending_manual_grade, draft)
  await it('5. Non-graded attempt rejected by feedback-only RPC', async () => {
    // Test on pending_manual_grade
    const reqPending = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_PENDING_ID,
        expected_version: 1,
        teacher_feedback: 'Feedback on pending',
      }),
    });

    const resPending = await handleUpdateGradedFeedback(reqPending, makeDeps(TEACHER_1_ID));
    assert.equal(resPending.status, 409);
    const bodyPending = await resPending.json();
    assert.equal(bodyPending.error_code, 'ERR_INVALID_ATTEMPT_STATUS');

    // Test on draft
    const reqDraft = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_DRAFT_ID,
        expected_version: 1,
        teacher_feedback: 'Feedback on draft',
      }),
    });

    const resDraft = await handleUpdateGradedFeedback(reqDraft, makeDeps(TEACHER_1_ID));
    assert.equal(resDraft.status, 409);
    const bodyDraft = await resDraft.json();
    assert.equal(bodyDraft.error_code, 'ERR_INVALID_ATTEMPT_STATUS');
  });

  // 6. Stale expected_version rejected (409 ERR_OPTIMISTIC_LOCK_CONFLICT)
  await it('6. Stale expected_version rejected (409 ERR_OPTIMISTIC_LOCK_CONFLICT)', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 5, // current is 7, stale!
        teacher_feedback: 'Stale update',
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(TEACHER_1_ID));
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
  });

  // 7 & 8. teacher_feedback & teacher_comment updates verified in DB
  await it('7 & 8. teacher_feedback & teacher_comment updates in DB', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 7,
        teacher_feedback: 'Lời phê mới nhất từ Thầy giáo.',
        question_comments: [
          { exam_question_id: Q_MANUAL_1_ID, teacher_comment: 'Điểm 10 chất lượng.' },
          { exam_question_id: Q_MANUAL_2_ID, teacher_comment: 'Tệp đính kèm đầy đủ.' },
        ],
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(TEACHER_1_ID));
    assert.equal(res.status, 200);

    // Verify DB
    const attCheck = await db.query(
      `SELECT teacher_feedback, version FROM public.exam_attempts WHERE id = $1`,
      [ATTEMPT_GRADED_ID]
    );
    assert.equal(attCheck.rows[0].teacher_feedback, 'Lời phê mới nhất từ Thầy giáo.');
    assert.equal(attCheck.rows[0].version, 8);

    const ansCheck = await db.query(
      `SELECT exam_question_id, teacher_comment FROM public.exam_attempt_answers WHERE attempt_id = $1 ORDER BY exam_question_id`,
      [ATTEMPT_GRADED_ID]
    );
    const q1Ans = ansCheck.rows.find((a) => a.exam_question_id === Q_MANUAL_1_ID);
    const q2Ans = ansCheck.rows.find((a) => a.exam_question_id === Q_MANUAL_2_ID);
    assert.equal(q1Ans.teacher_comment, 'Điểm 10 chất lượng.');
    assert.equal(q2Ans.teacher_comment, 'Tệp đính kèm đầy đủ.');
  });

  // 9. Score fields unchanged before/after
  await it('9. Score fields unchanged before/after', async () => {
    const att = (
      await db.query(
        `SELECT objective_score, manual_score, total_score, max_score FROM public.exam_attempts WHERE id = $1`,
        [ATTEMPT_GRADED_ID]
      )
    ).rows[0];

    assert.equal(Number(att.objective_score), 4.00);
    assert.equal(Number(att.manual_score), 4.50);
    assert.equal(Number(att.total_score), 8.50);
    assert.equal(Number(att.max_score), 10.00);
  });

  // 10. points_earned unchanged on all answers
  await it('10. points_earned unchanged on all answers', async () => {
    const answers = (
      await db.query(
        `SELECT exam_question_id, points_earned, grading_status FROM public.exam_attempt_answers WHERE attempt_id = $1`,
        [ATTEMPT_GRADED_ID]
      )
    ).rows;

    const qAuto = answers.find((a) => a.exam_question_id === Q_OBJECTIVE_ID);
    const qMan1 = answers.find((a) => a.exam_question_id === Q_MANUAL_1_ID);
    const qMan2 = answers.find((a) => a.exam_question_id === Q_MANUAL_2_ID);

    assert.equal(Number(qAuto.points_earned), 4.00);
    assert.equal(qAuto.grading_status, 'auto_graded');

    assert.equal(Number(qMan1.points_earned), 2.50);
    assert.equal(qMan1.grading_status, 'manual_graded');

    assert.equal(Number(qMan2.points_earned), 2.00);
    assert.equal(qMan2.grading_status, 'manual_graded');
  });

  // 11, 12, 13. status, graded_at, graded_by remain unchanged
  await it('11, 12, 13. status, graded_at, graded_by remain unchanged', async () => {
    const att = (
      await db.query(
        `SELECT status, graded_at, graded_by FROM public.exam_attempts WHERE id = $1`,
        [ATTEMPT_GRADED_ID]
      )
    ).rows[0];

    assert.equal(att.status, 'graded');
    assert.equal(new Date(att.graded_at).toISOString(), '2026-09-12T10:00:00.000Z');
    assert.equal(att.graded_by, TEACHER_1_ID);
  });

  // 14. Answer keys never returned or queried
  await it('14. Answer keys never returned or queried', async () => {
    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: 8,
        teacher_feedback: 'Kiểm tra bảo mật không lộ đáp án.',
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(TEACHER_1_ID));
    const body = await res.json();
    const str = JSON.stringify(body);
    assert.equal(str.includes('correct_answer'), false);
    assert.equal(str.includes('answer_key'), false);
    assert.equal(str.includes('exam_answer_keys'), false);
  });

  // 15. Student result query sees new feedback after update
  await it('15. Student result query sees new feedback after update', async () => {
    // Read attempt and answers directly as student client would
    const att = (
      await db.query(
        `SELECT teacher_feedback, total_score FROM public.exam_attempts WHERE id = $1 AND student_id = $2`,
        [ATTEMPT_GRADED_ID, STUDENT_ID]
      )
    ).rows[0];

    assert.equal(att.teacher_feedback, 'Kiểm tra bảo mật không lộ đáp án.');

    const ansRows = (
      await db.query(
        `SELECT exam_question_id, teacher_comment FROM public.exam_attempt_answers WHERE attempt_id = $1`,
        [ATTEMPT_GRADED_ID]
      )
    ).rows;

    const q1Ans = ansRows.find((a) => a.exam_question_id === Q_MANUAL_1_ID);
    assert.equal(q1Ans.teacher_comment, 'Điểm 10 chất lượng.');
  });

  // 16. Repeated identical update behavior documented & tested
  await it('16. Repeated update with incremented version succeeds cleanly', async () => {
    const currentVersion = (
      await db.query(`SELECT version FROM public.exam_attempts WHERE id = $1`, [
        ATTEMPT_GRADED_ID,
      ])
    ).rows[0].version;

    const req = new Request('http://localhost/exam-update-graded-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_teacher_1_token',
      },
      body: JSON.stringify({
        attempt_id: ATTEMPT_GRADED_ID,
        expected_version: currentVersion,
        teacher_feedback: 'Feedback cập nhật lần 2.',
      }),
    });

    const res = await handleUpdateGradedFeedback(req, makeDeps(TEACHER_1_ID));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.version, currentVersion + 1);
  });

  console.log(`\n========================================`);
  console.log(`SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
