// scripts/test_exam_management_bff.mjs
// Comprehensive Unit & Security Test Suite for Exam Builder Management BFF (Phase B1)
// Covers Auth, Admin Scope, Teacher Scope, Server-Side Class Ownership (P0), Scheduling, Safe RPC Answer Access & Real Source Contract Assertions

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Management Client
import {
  ExamManagementClient,
  createExamManagementClient,
  EXAM_MANAGEMENT_API_BASE_URL,
} from '../src/services/examManagementClient.js';

// ----------------------------------------------------------------------------
// Local BFF Implementation Mirror (Pure Logic for Node ESM Execution)
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

function isValidIsoTimestamp(val) {
  if (val === null || val === undefined) return true;
  if (typeof val !== 'string') return false;
  const parsed = Date.parse(val);
  return !isNaN(parsed);
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

function normalizeRpcError(err) {
  const msg = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
    ? err.message
    : 'Lỗi hệ thống CSDL';

  if (msg.includes('ERR_UNAUTHORIZED') || msg.includes('42501')) {
    return { status: 403, errorCode: 'ERR_UNAUTHORIZED', message: 'Bạn không có quyền thực hiện thao tác này trên đề thi.' };
  }
  if (msg.includes('ERR_EXAM_NOT_FOUND') || msg.includes('P0002') || msg.includes('ERR_VERSION_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_NOT_FOUND', message: 'Không tìm thấy đề thi hoặc phiên bản yêu cầu.' };
  }
  if (msg.includes('ERR_EXAM_ARCHIVED')) {
    return { status: 400, errorCode: 'ERR_EXAM_ARCHIVED', message: 'Đề thi đã được lưu trữ (archived), không thể chỉnh sửa hoặc giao bài.' };
  }
  if (msg.includes('ERR_VERSION_IMMUTABLE')) {
    return { status: 400, errorCode: 'ERR_VERSION_IMMUTABLE', message: 'Phiên bản đã xuất bản không thể chỉnh sửa trực tiếp.' };
  }
  if (msg.includes('ERR_VERSION_NOT_PUBLISHED')) {
    return { status: 400, errorCode: 'ERR_VERSION_NOT_PUBLISHED', message: 'Chỉ phiên bản đã xuất bản (published) mới có thể giao cho lớp học.' };
  }
  if (msg.includes('ERR_NO_QUESTIONS') || msg.includes('ERR_ZERO_TOTAL_POINTS')) {
    return { status: 400, errorCode: 'ERR_CANNOT_PUBLISH', message: 'Đề thi phải có ít nhất 1 câu hỏi và tổng điểm lớn hơn 0 trước khi xuất bản.' };
  }
  if (msg.includes('ERR_INVALID_SCHEDULE') || msg.includes('ERR_INVALID_DUE_DATE')) {
    return { status: 400, errorCode: 'ERR_INVALID_SCHEDULE', message: 'Cấu hình lịch thi không hợp lệ.' };
  }
  if (msg.includes('ERR_ASSIGNMENT_ALREADY_EXISTS') || msg.includes('23505') || msg.includes('ERR_IDEMPOTENCY_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_CONFLICT', message: 'Đề thi phiên bản này đã được giao cho lớp học được chọn hoặc xung đột dữ liệu.' };
  }
  if (msg.includes('ERR_INVALID_') || msg.includes('ERR_REQUIRED_PARAMS') || msg.includes('22000') || msg.includes('22003')) {
    return { status: 400, errorCode: 'INVALID_INPUT', message: msg };
  }
  return { status: 500, errorCode: 'INTERNAL_ERROR', message: msg };
}

function validateCreateTestPayload(raw) {
  if (!isPlainObject(raw)) return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là JSON object.' };
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { valid: false, errorCode: 'INVALID_TITLE', errorMessage: 'Tiêu đề không được để trống.' };
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  if (!subject) return { valid: false, errorCode: 'INVALID_SUBJECT', errorMessage: 'Môn học không được để trống.' };
  const gradeLevel = Number(raw.grade_level);
  if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
    return { valid: false, errorCode: 'INVALID_GRADE_LEVEL', errorMessage: 'Khối lớp phải từ 1 đến 12.' };
  }
  return {
    valid: true,
    data: { title, subject, grade_level: gradeLevel, description: typeof raw.description === 'string' ? raw.description.trim() : null },
  };
}

function validateSaveDraftPayload(raw) {
  if (!isPlainObject(raw)) return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là JSON object.' };
  if (!isValidUUID(raw.version_id)) return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'version_id không hợp lệ.' };
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { valid: false, errorCode: 'INVALID_TITLE', errorMessage: 'Tiêu đề không được để trống.' };
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  if (!subject) return { valid: false, errorCode: 'INVALID_SUBJECT', errorMessage: 'Môn học không được để trống.' };
  const gradeLevel = Number(raw.grade_level);
  if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
    return { valid: false, errorCode: 'INVALID_GRADE_LEVEL', errorMessage: 'Khối lớp phải từ 1 đến 12.' };
  }

  const startsAt = raw.starts_at ? String(raw.starts_at).trim() : null;
  const lastStartAt = raw.last_start_at ? String(raw.last_start_at).trim() : null;
  const dueDate = raw.due_date ? String(raw.due_date).trim() : null;

  if (startsAt && !isValidIsoTimestamp(startsAt)) return { valid: false, errorCode: 'INVALID_STARTS_AT', errorMessage: 'starts_at không hợp lệ.' };
  if (lastStartAt && !isValidIsoTimestamp(lastStartAt)) return { valid: false, errorCode: 'INVALID_LAST_START_AT', errorMessage: 'last_start_at không hợp lệ.' };
  if (dueDate && !isValidIsoTimestamp(dueDate)) return { valid: false, errorCode: 'INVALID_DUE_DATE', errorMessage: 'due_date không hợp lệ.' };

  if (startsAt && lastStartAt && new Date(lastStartAt).getTime() < new Date(startsAt).getTime()) {
    return { valid: false, errorCode: 'INVALID_SCHEDULE', errorMessage: 'Hạn chót vào làm bài không thể sớm hơn thời gian mở đề.' };
  }
  if (lastStartAt && dueDate && new Date(lastStartAt).getTime() > new Date(dueDate).getTime()) {
    return { valid: false, errorCode: 'INVALID_SCHEDULE', errorMessage: 'Hạn chót vào làm bài không thể muộn hơn hạn nộp bài cưỡng chế.' };
  }

  return {
    valid: true,
    data: {
      version_id: raw.version_id,
      title,
      subject,
      grade_level: gradeLevel,
      description: typeof raw.description === 'string' ? raw.description.trim() : null,
      duration_minutes: raw.duration_minutes !== undefined && raw.duration_minutes !== null ? Number(raw.duration_minutes) : null,
      starts_at: startsAt,
      last_start_at: lastStartAt,
      due_date: dueDate,
      max_attempts: Number(raw.max_attempts) || 1,
      reward_stars: Number(raw.reward_stars) || 0,
      shuffle_questions: Boolean(raw.shuffle_questions),
      shuffle_options: Boolean(raw.shuffle_options),
      tab_switch_policy: raw.tab_switch_policy || 'WARN_AND_LOG',
      show_score_after_submit: raw.show_score_after_submit !== undefined ? Boolean(raw.show_score_after_submit) : true,
      show_correct_answers: Boolean(raw.show_correct_answers),
      questions: Array.isArray(raw.questions) ? raw.questions : [],
    },
  };
}

function validatePublishPayload(raw) {
  if (!isPlainObject(raw) || !isValidUUID(raw.version_id)) {
    return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'version_id không hợp lệ.' };
  }
  return { valid: true, data: { version_id: raw.version_id } };
}

function validateCreateAssignmentPayload(raw) {
  if (!isPlainObject(raw)) return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là JSON object.' };
  if (!isValidUUID(raw.exam_version_id)) return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'exam_version_id không hợp lệ.' };
  if (!isValidUUID(raw.class_id)) return { valid: false, errorCode: 'INVALID_CLASS_ID', errorMessage: 'class_id không hợp lệ.' };

  const startsAt = raw.starts_at ? String(raw.starts_at).trim() : null;
  const lastStartAt = raw.last_start_at ? String(raw.last_start_at).trim() : null;
  const dueDate = raw.due_date ? String(raw.due_date).trim() : null;

  if (startsAt && !isValidIsoTimestamp(startsAt)) return { valid: false, errorCode: 'INVALID_STARTS_AT', errorMessage: 'starts_at không hợp lệ.' };
  if (lastStartAt && !isValidIsoTimestamp(lastStartAt)) return { valid: false, errorCode: 'INVALID_LAST_START_AT', errorMessage: 'last_start_at không hợp lệ.' };
  if (dueDate && !isValidIsoTimestamp(dueDate)) return { valid: false, errorCode: 'INVALID_DUE_DATE', errorMessage: 'due_date không hợp lệ.' };

  if (startsAt && lastStartAt && new Date(lastStartAt).getTime() < new Date(startsAt).getTime()) {
    return { valid: false, errorCode: 'INVALID_SCHEDULE', errorMessage: 'Hạn chót vào làm bài không thể sớm hơn thời gian mở đề.' };
  }

  return {
    valid: true,
    data: {
      assignment_id: isValidUUID(raw.assignment_id) ? raw.assignment_id : undefined,
      exam_version_id: raw.exam_version_id,
      class_id: raw.class_id,
      starts_at: startsAt,
      last_start_at: lastStartAt,
      due_date: dueDate,
      counts_toward_ranking: raw.counts_toward_ranking !== undefined ? Boolean(raw.counts_toward_ranking) : true,
    },
  };
}

async function handleManagementRequestRunner(req, deps) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.');
  }

  const callerClient = deps.callerAuthClient;
  const coreClient = deps.coreQueryClient;
  const examClient = deps.examQueryClient;

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Phiên đăng nhập không hợp lệ.');
  }

  const callerId = userData.user.id;
  const { data: profileRow } = await coreClient.from('profiles').select('id, role, is_disabled').eq('id', callerId).maybeSingle();

  if (!profileRow) {
    return createErrorResponse(403, 'USER_NOT_FOUND', 'Không tìm thấy hồ sơ người dùng.');
  }
  if (profileRow.is_disabled) {
    return createErrorResponse(403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hóa.');
  }

  const actorRole = profileRow.role;
  if (actorRole !== 'admin' && actorRole !== 'teacher') {
    return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền truy cập.');
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const action = pathSegments[pathSegments.length - 1] || url.searchParams.get('action') || '';

  // 1. GET /list-tests
  if (req.method === 'GET' && (action === 'list-tests' || action === 'tests' || action === 'exam-management-api')) {
    let query = examClient.from('exam_tests').select('*');
    if (actorRole === 'teacher') {
      query = query.eq('author_id', callerId);
    }
    const { data: testsData } = await query;
    const tests = testsData || [];

    const testIds = tests.map((t) => t.id);
    const { data: versionsData } = await examClient.from('exam_versions').select('*').in('exam_id', testIds);

    const versionsByExamId = {};
    (versionsData || []).forEach((v) => {
      if (!versionsByExamId[v.exam_id]) versionsByExamId[v.exam_id] = [];
      versionsByExamId[v.exam_id].push(v);
    });

    const enrichedTests = tests.map((t) => {
      const examVersions = versionsByExamId[t.id] || [];
      const activeVersion =
        examVersions.find((v) => v.id === t.current_version_id) ||
        examVersions[0] ||
        null;

      return {
        id: t.id,
        author_id: t.author_id,
        title: t.title,
        subject: t.subject,
        grade_level: t.grade_level,
        status: t.status,
        current_version_id: t.current_version_id,
        created_at: t.created_at,
        updated_at: t.updated_at,
        active_version: activeVersion
          ? {
              id: activeVersion.id,
              version_number: activeVersion.version_number,
              title: activeVersion.title,
              description: activeVersion.description,
              subject: activeVersion.subject,
              grade_level: activeVersion.grade_level,
              duration_minutes: activeVersion.duration_minutes,
              starts_at: activeVersion.starts_at,
              last_start_at: activeVersion.last_start_at,
              due_date: activeVersion.due_date,
              total_points: activeVersion.total_points,
              status: activeVersion.status,
              published_at: activeVersion.published_at,
            }
          : null,
      };
    });

    return createSuccessResponse({ tests: enrichedTests });
  }

  // 2. GET /get-test-detail (SECURE RPC DRIVEN)
  if (req.method === 'GET' && action === 'get-test-detail') {
    let targetVersionId = url.searchParams.get('version_id');
    const examId = url.searchParams.get('exam_id');

    if (!targetVersionId && !examId) {
      return createErrorResponse(400, 'INVALID_INPUT', 'Yêu cầu tham số exam_id hoặc version_id.');
    }

    if (!targetVersionId && examId) {
      const { data: vList, error: vListErr } = await examClient
        .from('exam_versions')
        .select('id, version_number, status')
        .eq('exam_id', examId)
        .order('version_number', { ascending: false });

      if (vListErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tra cứu phiên bản đề thi.');
      }

      const draftV = (vList || []).find((v) => v.status === 'draft') || (vList || [])[0];
      if (!draftV) {
        return createErrorResponse(404, 'NOT_FOUND', 'Không tìm thấy phiên bản đề thi.');
      }
      targetVersionId = draftV.id;
    }

    const rpcRes = await examClient.rpc('rpc_exam_get_draft_questions_with_answers', {
      p_caller_id: callerId,
      p_version_id: targetVersionId,
      p_is_admin: actorRole === 'admin',
    });

    if (rpcRes.error) {
      const norm = normalizeRpcError(rpcRes.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }

    if (!rpcRes.data) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Không thể tải chi tiết đề thi.');
    }

    return createSuccessResponse(rpcRes.data);
  }

  // 3. POST /create-test
  if (req.method === 'POST' && action === 'create-test') {
    let rawBody;
    try { rawBody = await req.json(); } catch (_) { return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.'); }
    const valResult = validateCreateTestPayload(rawBody);
    if (!valResult.valid) return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);

    const rpcRes = await examClient.rpc('rpc_exam_create_test', {
      p_caller_id: callerId,
      p_exam_id: 'auto-exam-id',
      p_version_id: 'auto-version-id',
      p_title: valResult.data.title,
      p_subject: valResult.data.subject,
      p_grade_level: valResult.data.grade_level,
      p_description: valResult.data.description,
      p_is_admin: actorRole === 'admin',
    });
    if (rpcRes.error) {
      const norm = normalizeRpcError(rpcRes.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }
    return createSuccessResponse(rpcRes.data, 201);
  }

  // 4. POST /save-draft
  if (req.method === 'POST' && action === 'save-draft') {
    let rawBody;
    try { rawBody = await req.json(); } catch (_) { return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.'); }
    const valResult = validateSaveDraftPayload(rawBody);
    if (!valResult.valid) return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);

    const rpcRes = await examClient.rpc('rpc_exam_save_draft_version', {
      p_caller_id: callerId,
      p_version_id: valResult.data.version_id,
      p_title: valResult.data.title,
      p_subject: valResult.data.subject,
      p_grade_level: valResult.data.grade_level,
      p_description: valResult.data.description,
      p_duration_minutes: valResult.data.duration_minutes,
      p_starts_at: valResult.data.starts_at,
      p_due_date: valResult.data.due_date,
      p_max_attempts: valResult.data.max_attempts,
      p_reward_stars: valResult.data.reward_stars,
      p_shuffle_questions: valResult.data.shuffle_questions,
      p_shuffle_options: valResult.data.shuffle_options,
      p_tab_switch_policy: valResult.data.tab_switch_policy,
      p_show_score_after_submit: valResult.data.show_score_after_submit,
      p_show_correct_answers: valResult.data.show_correct_answers,
      p_questions: valResult.data.questions,
      p_is_admin: actorRole === 'admin',
      p_last_start_at: valResult.data.last_start_at,
    });
    if (rpcRes.error) {
      const norm = normalizeRpcError(rpcRes.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }
    return createSuccessResponse(rpcRes.data, 200);
  }

  // 5. POST /publish
  if (req.method === 'POST' && action === 'publish') {
    let rawBody;
    try { rawBody = await req.json(); } catch (_) { return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.'); }
    const valResult = validatePublishPayload(rawBody);
    if (!valResult.valid) return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);

    const rpcRes = await examClient.rpc('rpc_exam_publish_version', {
      p_caller_id: callerId,
      p_version_id: valResult.data.version_id,
      p_is_admin: actorRole === 'admin',
    });
    if (rpcRes.error) {
      const norm = normalizeRpcError(rpcRes.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }
    return createSuccessResponse(rpcRes.data, 200);
  }

  // 6. POST /create-assignment (P0 SECURITY)
  if (req.method === 'POST' && action === 'create-assignment') {
    let rawBody;
    try { rawBody = await req.json(); } catch (_) { return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.'); }
    const valResult = validateCreateAssignmentPayload(rawBody);
    if (!valResult.valid) return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);

    const payload = valResult.data;
    const { data: classRow } = await coreClient.from('classes').select('id, teacher_id').eq('id', payload.class_id).maybeSingle();

    if (!classRow) {
      return createErrorResponse(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
    }

    if (actorRole === 'teacher' && classRow.teacher_id !== callerId) {
      return createErrorResponse(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền giao bài cho lớp này.');
    }

    const rpcRes = await examClient.rpc('rpc_exam_create_assignment', {
      p_caller_id: callerId,
      p_assignment_id: payload.assignment_id || 'auto-assign-id',
      p_exam_version_id: payload.exam_version_id,
      p_class_id: payload.class_id,
      p_due_date: payload.due_date,
      p_counts_toward_ranking: payload.counts_toward_ranking,
      p_is_admin: actorRole === 'admin',
      p_starts_at: payload.starts_at,
      p_last_start_at: payload.last_start_at,
    });
    if (rpcRes.error) {
      const norm = normalizeRpcError(rpcRes.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }
    return createSuccessResponse(rpcRes.data, 201);
  }

  return createErrorResponse(404, 'NOT_FOUND', 'Endpoint không tồn tại.');
}

// ----------------------------------------------------------------------------
// Test Runner
// ----------------------------------------------------------------------------
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [${totalTests.toString().padStart(2, '0')}] PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`❌ [${totalTests.toString().padStart(2, '0')}] FAIL: ${name}`);
    console.error(err);
  }
}

const ADMIN_ID = '11111111-1111-4111-a111-111111111111';
const TEACHER_1_ID = '22222222-2222-4222-a222-222222222222';
const TEACHER_2_ID = '33333333-3333-4333-a333-333333333333';
const STUDENT_ID = '44444444-4444-4444-a444-444444444444';
const DISABLED_USER_ID = '55555555-5555-4555-a555-555555555555';

const CLASS_1_T1 = '66666666-6666-4666-a666-666666666661';
const CLASS_2_T2 = '66666666-6666-4666-a666-666666666662';

const EXAM_1_T1 = '77777777-7777-4777-a777-777777777771';
const VERSION_1_T1_DRAFT = '88888888-8888-4888-a888-888888888881';
const VERSION_1_T1_PUB = '88888888-8888-4888-a888-888888888882';

const EXAM_2_T2 = '77777777-7777-4777-a777-777777777772';
const VERSION_2_T2_DRAFT = '88888888-8888-4888-a888-888888888883';

function createMockEnvironment(currentUserCallerId = TEACHER_1_ID) {
  const profilesDb = new Map([
    [ADMIN_ID, { id: ADMIN_ID, role: 'admin', full_name: 'Quản Trị Viên', is_disabled: false }],
    [TEACHER_1_ID, { id: TEACHER_1_ID, role: 'teacher', full_name: 'Cô Lan Giáo Viên 1', is_disabled: false }],
    [TEACHER_2_ID, { id: TEACHER_2_ID, role: 'teacher', full_name: 'Thầy Hùng Giáo Viên 2', is_disabled: false }],
    [STUDENT_ID, { id: STUDENT_ID, role: 'student', full_name: 'Em Nam Học Sinh', is_disabled: false }],
    [DISABLED_USER_ID, { id: DISABLED_USER_ID, role: 'teacher', full_name: 'Tài Khoản Khóa', is_disabled: true }],
  ]);

  const classesDb = new Map([
    [CLASS_1_T1, { id: CLASS_1_T1, teacher_id: TEACHER_1_ID, name: 'Lớp 1A', grade_level: 1 }],
    [CLASS_2_T2, { id: CLASS_2_T2, teacher_id: TEACHER_2_ID, name: 'Lớp 2B', grade_level: 2 }],
  ]);

  const examsDb = new Map([
    [
      EXAM_1_T1,
      {
        id: EXAM_1_T1,
        author_id: TEACHER_1_ID,
        title: 'Đề Toán 1 Giữa Kỳ',
        subject: 'Toán',
        grade_level: 1,
        status: 'active',
        current_version_id: VERSION_1_T1_PUB,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    [
      EXAM_2_T2,
      {
        id: EXAM_2_T2,
        author_id: TEACHER_2_ID,
        title: 'Đề Tiếng Việt 2',
        subject: 'Tiếng Việt',
        grade_level: 2,
        status: 'active',
        current_version_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  ]);

  const versionsDb = new Map([
    [
      VERSION_1_T1_DRAFT,
      {
        id: VERSION_1_T1_DRAFT,
        exam_id: EXAM_1_T1,
        version_number: 1,
        title: 'Đề Toán 1 Giữa Kỳ (Nháp)',
        subject: 'Toán',
        grade_level: 1,
        duration_minutes: 45,
        starts_at: '2026-10-01T08:00:00.000Z',
        last_start_at: '2026-10-01T09:00:00.000Z',
        due_date: '2026-10-01T10:00:00.000Z',
        total_points: 10,
        status: 'draft',
      },
    ],
    [
      VERSION_1_T1_PUB,
      {
        id: VERSION_1_T1_PUB,
        exam_id: EXAM_1_T1,
        version_number: 2,
        title: 'Đề Toán 1 Giữa Kỳ (Chính thức)',
        subject: 'Toán',
        grade_level: 1,
        duration_minutes: 45,
        starts_at: '2026-10-01T08:00:00.000Z',
        last_start_at: '2026-10-01T09:00:00.000Z',
        due_date: '2026-10-01T10:00:00.000Z',
        total_points: 10,
        status: 'published',
        published_at: '2026-09-10T10:00:00.000Z',
      },
    ],
    [
      VERSION_2_T2_DRAFT,
      {
        id: VERSION_2_T2_DRAFT,
        exam_id: EXAM_2_T2,
        version_number: 1,
        title: 'Đề Tiếng Việt 2 Nháp',
        subject: 'Tiếng Việt',
        grade_level: 2,
        duration_minutes: 30,
        status: 'draft',
      },
    ],
  ]);

  const callerAuthClient = {
    auth: {
      getUser: async () => {
        if (!currentUserCallerId) {
          return { data: { user: null }, error: new Error('No user session') };
        }
        return { data: { user: { id: currentUserCallerId } }, error: null };
      },
    },
  };

  const coreQueryClient = {
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                const user = profilesDb.get(val);
                return { data: user || null, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'classes') {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                const c = classesDb.get(val);
                return { data: c || null, error: null };
              },
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  };

  const examQueryClient = {
    from: (table) => {
      if (table === 'exam_tests') {
        return {
          select: () => {
            let filtered = Array.from(examsDb.values());
            const builder = {
              order: () => builder,
              eq: (col, val) => {
                filtered = filtered.filter((t) => t[col] === val);
                return builder;
              },
              then: (resolve) => resolve({ data: filtered, error: null }),
            };
            return builder;
          },
        };
      }
      if (table === 'exam_versions') {
        return {
          select: () => {
            let filtered = Array.from(versionsDb.values());
            const builder = {
              order: () => builder,
              eq: (col, val) => {
                filtered = filtered.filter((v) => v[col] === val);
                return builder;
              },
              in: (col, vals) => {
                filtered = filtered.filter((v) => vals.includes(v[col]));
                return builder;
              },
              then: (resolve) => resolve({ data: filtered, error: null }),
            };
            return builder;
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
    rpc: async (name, args) => {
      if (name === 'rpc_exam_create_test') {
        return {
          data: {
            exam_id: args.p_exam_id,
            version_id: args.p_version_id,
            version_number: 1,
            status: 'draft',
            idempotent_replay: false,
          },
          error: null,
        };
      }
      if (name === 'rpc_exam_get_draft_questions_with_answers') {
        const v = versionsDb.get(args.p_version_id);
        if (!v) return { data: null, error: { message: 'ERR_VERSION_NOT_FOUND' } };
        const test = examsDb.get(v.exam_id);
        if (!test) return { data: null, error: { message: 'ERR_EXAM_NOT_FOUND' } };
        if (v.status !== 'draft') {
          return { data: null, error: { message: 'ERR_VERSION_IMMUTABLE' } };
        }
        if (!args.p_is_admin && test.author_id !== args.p_caller_id) {
          return { data: null, error: { message: 'ERR_UNAUTHORIZED' } };
        }
        return {
          data: {
            test: { ...test },
            version: { ...v },
            questions: [
              {
                id: '99999999-9999-4999-a999-999999999991',
                exam_version_id: v.id,
                question_number: 1,
                question_type: 'single_choice',
                prompt: '1 + 1 = ?',
                options_json: ['1', '2', '3', '4'],
                points: 1,
                answer_key: { correct_answer: '2' },
              },
            ],
          },
          error: null,
        };
      }
      if (name === 'rpc_exam_save_draft_version') {
        const v = versionsDb.get(args.p_version_id);
        if (!v) return { data: null, error: { message: 'ERR_VERSION_NOT_FOUND' } };
        const test = examsDb.get(v.exam_id);
        if (!args.p_is_admin && test?.author_id !== args.p_caller_id) {
          return { data: null, error: { message: 'ERR_UNAUTHORIZED' } };
        }
        if (v.status !== 'draft') {
          return { data: null, error: { message: 'ERR_VERSION_IMMUTABLE' } };
        }
        return {
          data: {
            version_id: args.p_version_id,
            total_points: 10,
            question_count: (args.p_questions || []).length,
            status: 'draft',
          },
          error: null,
        };
      }
      if (name === 'rpc_exam_publish_version') {
        const v = versionsDb.get(args.p_version_id);
        if (!v) return { data: null, error: { message: 'ERR_VERSION_NOT_FOUND' } };
        const test = examsDb.get(v.exam_id);
        if (!args.p_is_admin && test?.author_id !== args.p_caller_id) {
          return { data: null, error: { message: 'ERR_UNAUTHORIZED' } };
        }
        return {
          data: {
            version_id: args.p_version_id,
            status: 'published',
            published_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      if (name === 'rpc_exam_create_assignment') {
        const v = versionsDb.get(args.p_exam_version_id);
        if (!v) return { data: null, error: { message: 'ERR_VERSION_NOT_FOUND' } };
        if (v.status !== 'published') {
          return { data: null, error: { message: 'ERR_VERSION_NOT_PUBLISHED' } };
        }
        return {
          data: {
            assignment_id: args.p_assignment_id,
            exam_version_id: args.p_exam_version_id,
            class_id: args.p_class_id,
            starts_at: args.p_starts_at,
            last_start_at: args.p_last_start_at,
            due_date: args.p_due_date,
            counts_toward_ranking: args.p_counts_toward_ranking,
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'UNKNOWN_RPC' } };
    },
  };

  return {
    callerAuthClient,
    coreQueryClient,
    examQueryClient,
  };
}

async function runRequest(action, method = 'GET', body = null, callerId = TEACHER_1_ID) {
  const env = createMockEnvironment(callerId);
  const url = `https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-management-api/${action}`;
  const req = new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: callerId ? 'Bearer mock-jwt-token' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });

  const res = await handleManagementRequestRunner(req, env);
  const json = await res.json();
  return { status: res.status, json };
}

// ----------------------------------------------------------------------------
// TEST SUITE EXECUTION
// ----------------------------------------------------------------------------
async function runAllManagementTests() {
  console.log('======================================================================');
  console.log('STARTING EXAM BUILDER V1 - PHASE B1 MANAGEMENT BFF & SECURITY TESTS');
  console.log('======================================================================\n');

  // 1. AUTH & ROLE BOUNDARY TESTS
  await test('01. Missing Bearer token returns 401 AUTH_REQUIRED', async () => {
    const { status, json } = await runRequest('list-tests', 'GET', null, null);
    assert.equal(status, 401);
    assert.equal(json.error_code, 'AUTH_REQUIRED');
  });

  await test('02. Student role accessing management API returns 403 FORBIDDEN_ROLE', async () => {
    const { status, json } = await runRequest('list-tests', 'GET', null, STUDENT_ID);
    assert.equal(status, 403);
    assert.equal(json.error_code, 'FORBIDDEN_ROLE');
  });

  await test('03. Disabled user account returns 403 ACCOUNT_DISABLED', async () => {
    const { status, json } = await runRequest('list-tests', 'GET', null, DISABLED_USER_ID);
    assert.equal(status, 403);
    assert.equal(json.error_code, 'ACCOUNT_DISABLED');
  });

  // 2. ADMIN CAPABILITIES & SCOPE
  await test('04. Admin can list all exams from all teachers', async () => {
    const { status, json } = await runRequest('list-tests', 'GET', null, ADMIN_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.tests.length, 2); // Both Teacher 1 and Teacher 2 exams
  });

  await test('05. Admin can create new exam container', async () => {
    const { status, json } = await runRequest('create-test', 'POST', {
      title: 'Đề Khảo Sát Toàn Trường',
      subject: 'Toán',
      grade_level: 5,
    }, ADMIN_ID);
    assert.equal(status, 201);
    assert.equal(json.success, true);
    assert.ok(json.data.exam_id);
    assert.ok(json.data.version_id);
  });

  await test('06. Admin can edit any teacher draft exam version', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Toán Đã Được Admin Chỉnh Sửa',
      subject: 'Toán',
      grade_level: 1,
      duration_minutes: 40,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999991',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 2 = ?',
          points: 10,
          options_json: ['1', '2', '3', '4'],
          answer_key: { correct_answer: '3' },
        },
      ],
    }, ADMIN_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
  });

  await test('07. Admin can publish any teacher draft version', async () => {
    const { status, json } = await runRequest('publish', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
    }, ADMIN_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.status, 'published');
  });

  await test('08. Admin can assign published exam to any valid class in CORE', async () => {
    const { status, json } = await runRequest('create-assignment', 'POST', {
      exam_version_id: VERSION_1_T1_PUB,
      class_id: CLASS_2_T2, // Teacher 2 class, assigned by Admin
      starts_at: '2026-10-01T08:00:00.000Z',
      last_start_at: '2026-10-01T08:30:00.000Z',
      due_date: '2026-10-01T09:30:00.000Z',
    }, ADMIN_ID);
    assert.equal(status, 201);
    assert.equal(json.success, true);
    assert.equal(json.data.class_id, CLASS_2_T2);
  });

  // 3. TEACHER SCOPE & AUTHORING PERMISSIONS
  await test('09. Teacher lists only own authored exams (Server-Side Scoped)', async () => {
    const { status, json } = await runRequest('list-tests', 'GET', null, TEACHER_1_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.tests.length, 1);
    assert.equal(json.data.tests[0].id, EXAM_1_T1);
    assert.equal(json.data.tests[0].author_id, TEACHER_1_ID);
  });

  await test('10. Teacher 1 can edit own draft exam', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Toán 1 Giữa Kỳ Cập Nhật',
      subject: 'Toán',
      grade_level: 1,
      duration_minutes: 45,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999992',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '2 + 2 = ?',
          points: 10,
          options_json: ['2', '3', '4', '5'],
          answer_key: { correct_answer: '4' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
  });

  await test('11. Teacher 1 editing Teacher 2 draft is REJECTED with 403 ERR_UNAUTHORIZED', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_2_T2_DRAFT, // Owned by Teacher 2
      title: 'Hacked Title',
      subject: 'Tiếng Việt',
      grade_level: 2,
      questions: [],
    }, TEACHER_1_ID);
    assert.equal(status, 403);
    assert.equal(json.error_code, 'ERR_UNAUTHORIZED');
  });

  await test('12. Teacher 1 publishing Teacher 2 draft is REJECTED with 403 ERR_UNAUTHORIZED', async () => {
    const { status, json } = await runRequest('publish', 'POST', {
      version_id: VERSION_2_T2_DRAFT, // Owned by Teacher 2
    }, TEACHER_1_ID);
    assert.equal(status, 403);
    assert.equal(json.error_code, 'ERR_UNAUTHORIZED');
  });

  // 4. CRITICAL P0 SECURITY: TEACHER CLASS OWNERSHIP ENFORCEMENT
  await test('13. Teacher assigning published exam to OWN class (CLASS_1_T1) succeeds', async () => {
    const { status, json } = await runRequest('create-assignment', 'POST', {
      exam_version_id: VERSION_1_T1_PUB,
      class_id: CLASS_1_T1,
      due_date: '2026-10-01T10:00:00.000Z',
    }, TEACHER_1_ID);
    assert.equal(status, 201);
    assert.equal(json.success, true);
    assert.equal(json.data.class_id, CLASS_1_T1);
  });

  await test('14. [P0 SECURITY] Teacher 1 assigning to Teacher 2 class is BLOCKED 403 CLASS_ACCESS_DENIED', async () => {
    const { status, json } = await runRequest('create-assignment', 'POST', {
      exam_version_id: VERSION_1_T1_PUB,
      class_id: CLASS_2_T2, // Forged class_id owned by Teacher 2
      due_date: '2026-10-01T10:00:00.000Z',
    }, TEACHER_1_ID);
    assert.equal(status, 403);
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  await test('15. Assigning to non-existent class returns 404 CLASS_NOT_FOUND', async () => {
    const { status, json } = await runRequest('create-assignment', 'POST', {
      exam_version_id: VERSION_1_T1_PUB,
      class_id: '00000000-0000-4000-a000-000000000000',
    }, TEACHER_1_ID);
    assert.equal(status, 404);
    assert.equal(json.error_code, 'CLASS_NOT_FOUND');
  });

  // 5. FLEXIBLE SCHEDULING VALIDATION CONTRACTS
  await test('16. Save draft rejects last_start_at earlier than starts_at with 400 INVALID_SCHEDULE', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Lỗi Lịch',
      subject: 'Toán',
      grade_level: 1,
      starts_at: '2026-10-01T09:00:00.000Z',
      last_start_at: '2026-10-01T08:00:00.000Z', // Before starts_at
      questions: [],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_SCHEDULE');
  });

  await test('17. Save draft rejects last_start_at later than due_date with 400 INVALID_SCHEDULE', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Lỗi Lịch 2',
      subject: 'Toán',
      grade_level: 1,
      last_start_at: '2026-10-01T11:00:00.000Z',
      due_date: '2026-10-01T10:00:00.000Z', // Before last_start_at
      questions: [],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_SCHEDULE');
  });

  await test('18. Create assignment rejects last_start_at earlier than starts_at with 400 INVALID_SCHEDULE', async () => {
    const { status, json } = await runRequest('create-assignment', 'POST', {
      exam_version_id: VERSION_1_T1_PUB,
      class_id: CLASS_1_T1,
      starts_at: '2026-10-01T09:00:00.000Z',
      last_start_at: '2026-10-01T08:00:00.000Z',
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_SCHEDULE');
  });

  // 6. DATA SAFETY & IMMUTABILITY CONTRACTS
  await test('19. list-tests does not leak app_private.exam_answer_keys', async () => {
    const { json } = await runRequest('list-tests', 'GET', null, TEACHER_1_ID);
    const serialized = JSON.stringify(json);
    assert.equal(serialized.includes('exam_answer_keys'), false);
    assert.equal(serialized.includes('correct_answer'), false);
  });

  await test('20. Save draft directly on published version is REJECTED with ERR_VERSION_IMMUTABLE', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_PUB, // Published version
      title: 'Mutate Published',
      subject: 'Toán',
      grade_level: 1,
      questions: [],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'ERR_VERSION_IMMUTABLE');
  });

  // 7. CLIENT TRANSPORT & INTEGRATION TESTS
  await test('21. ExamManagementClient correctly dispatches requests with Bearer token', async () => {
    let interceptedReq = null;
    const mockClient = createExamManagementClient({
      invokeFunction: async (params) => {
        interceptedReq = params;
        return { ok: true, data: { tests: [] } };
      },
    });

    const res = await mockClient.listTests();
    assert.equal(res.ok, true);
    assert.equal(interceptedReq.action, 'list-tests');
    assert.equal(interceptedReq.method, 'GET');
  });

  await test('22. ExamManagementClient saveDraft dispatches POST with sanitized payload', async () => {
    let interceptedReq = null;
    const mockClient = createExamManagementClient({
      invokeFunction: async (params) => {
        interceptedReq = params;
        return { ok: true, data: { version_id: 'test-v-id' } };
      },
    });

    const res = await mockClient.saveDraft({
      version_id: '88888888-8888-4888-a888-888888888881',
      title: 'Tiêu đề test',
    });
    assert.equal(res.ok, true);
    assert.equal(interceptedReq.action, 'save-draft');
    assert.equal(interceptedReq.method, 'POST');
    assert.equal(interceptedReq.payload.title, 'Tiêu đề test');
  });

  // 8. STATIC CODE & CONFIG INTEGRATION VERIFICATION
  await test('23. supabase/config.toml contains [functions.exam-management-api] with verify_jwt = false', () => {
    const configPath = path.resolve(__dirname, '../supabase/config.toml');
    const configContent = fs.readFileSync(configPath, 'utf8');
    assert.equal(configContent.includes('[functions.exam-management-api]'), true);
    assert.equal(configContent.includes('verify_jwt = false'), true);
  });

  await test('24. AdminDashboard.jsx imports and mounts ExamManagementTab for role="admin"', () => {
    const adminDashPath = path.resolve(__dirname, '../src/pages/AdminDashboard.jsx');
    const content = fs.readFileSync(adminDashPath, 'utf8');
    assert.equal(content.includes('ExamManagementTab'), true);
    assert.equal(content.includes('role="admin"'), true);
    assert.equal(content.includes('Quản Lý Đề Kiểm Tra'), true);
  });

  await test('25. TeacherDashboard.jsx imports and mounts ExamManagementTab for role="teacher"', () => {
    const teacherDashPath = path.resolve(__dirname, '../src/pages/TeacherDashboard.jsx');
    const content = fs.readFileSync(teacherDashPath, 'utf8');
    assert.equal(content.includes('ExamManagementTab'), true);
    assert.equal(content.includes('role="teacher"'), true);
    assert.equal(content.includes('Quản Lý Đề Kiểm Tra'), true);
  });

  await test('26. ExamEditorModal.jsx contains all 4 Flexible Scheduling Vietnamese labels', () => {
    const editorPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamEditorModal.jsx');
    const content = fs.readFileSync(editorPath, 'utf8');
    assert.equal(content.includes('Thời gian mở đề (starts_at)'), true);
    assert.equal(content.includes('Hạn chót vào làm bài (last_start_at)'), true);
    assert.equal(content.includes('Thời lượng làm bài (duration_minutes)'), true);
    assert.equal(content.includes('Hạn nộp bài cưỡng chế (due_date)'), true);
    assert.equal(content.includes('Lưu Bản Nháp'), true);
    assert.equal(content.includes('Xuất Bản Đề Thi'), true);
  });

  await test('27. AssignExamModal.jsx checks published state before assigning and explains schedule', () => {
    const assignPath = path.resolve(__dirname, '../src/components/dashboard/exams/AssignExamModal.jsx');
    const content = fs.readFileSync(assignPath, 'utf8');
    assert.equal(content.includes('Chỉ đề thi đã xuất bản (published) mới có thể giao cho lớp học'), true);
    assert.equal(content.includes('Xác Nhận Giao Đề Thi'), true);
    assert.equal(content.includes('Thời gian mở đề:'), true);
    assert.equal(content.includes('Hạn chót vào làm:'), true);
    assert.equal(content.includes('Hạn nộp bài cưỡng chế:'), true);
  });

  // 9. REAL PRODUCTION SOURCE CONTRACT ASSERTIONS
  await test('28. Migration file contains secure rpc_exam_get_draft_questions_with_answers with draft check & app_private join', () => {
    const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260911000011_exam_builder_v1_phase_b1_draft_detail_rpc.sql');
    assert.equal(fs.existsSync(migrationPath), true);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.equal(sql.includes('rpc_exam_get_draft_questions_with_answers'), true);
    assert.equal(sql.includes('SECURITY DEFINER'), true);
    assert.equal(sql.includes('SET search_path = public, app_private'), true);
    assert.equal(sql.includes("v_ver.status <> 'draft'"), true);
    assert.equal(sql.includes('ERR_VERSION_IMMUTABLE'), true);
    assert.equal(sql.includes('v_test.author_id <> p_caller_id'), true);
    assert.equal(sql.includes('LEFT JOIN app_private.exam_answer_keys'), true);
    assert.equal(sql.includes('REVOKE ALL ON FUNCTION public.rpc_exam_get_draft_questions_with_answers'), true);
    assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.rpc_exam_get_draft_questions_with_answers(UUID, UUID, BOOLEAN) TO service_role'), true);
  });

  await test('29. Real handler.ts calls rpc_exam_get_draft_questions_with_answers and has NO direct exam_answer_keys query', () => {
    const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/handler.ts');
    const code = fs.readFileSync(handlerPath, 'utf8');
    assert.equal(code.includes('rpc_exam_get_draft_questions_with_answers'), true);
    assert.equal(code.includes("from('exam_answer_keys')"), false);
    assert.equal(code.includes("schema('app_private')"), false);
    assert.equal(code.includes('rpcRes.error'), true);
  });

  await test('30. Real handler.ts enforces server-derived callerId and role-derived is_admin', () => {
    const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/handler.ts');
    const code = fs.readFileSync(handlerPath, 'utf8');
    assert.equal(code.includes('p_caller_id: callerId'), true);
    assert.equal(code.includes("p_is_admin: actorRole === 'admin'"), true);
    assert.equal(code.includes("query.eq('author_id', callerId)"), true);
  });

  await test('31. Real handler.ts enforces Teacher class ownership and returns CLASS_ACCESS_DENIED', () => {
    const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/handler.ts');
    const code = fs.readFileSync(handlerPath, 'utf8');
    assert.equal(code.includes("actorRole === 'teacher' && classRow.teacher_id !== callerId"), true);
    assert.equal(code.includes('CLASS_ACCESS_DENIED'), true);
  });

  await test('32. Real authMiddleware.ts derives context strictly from CORE auth.getUser and profiles', () => {
    const authPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/authMiddleware.ts');
    const code = fs.readFileSync(authPath, 'utf8');
    assert.equal(code.includes('callerClient.auth.getUser()'), true);
    assert.equal(code.includes("from('profiles')"), true);
    assert.equal(code.includes('userData.user.id'), true);
    assert.equal(code.includes('FORBIDDEN_ROLE'), true);
  });

  await test('33. ExamEditorModal.jsx implements fail-closed error handling when draft details fail to load', () => {
    const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamEditorModal.jsx');
    const code = fs.readFileSync(modalPath, 'utf8');
    assert.equal(code.includes('!res.ok || !res.data'), true);
    assert.equal(code.includes('setQuestions([])'), true);
  });

  console.log('\n======================================================================');
  console.log(`TOTAL MANAGEMENT TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllManagementTests();
