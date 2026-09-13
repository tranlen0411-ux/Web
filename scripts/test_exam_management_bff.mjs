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
import { deleteSingleChoiceOption } from '../src/components/dashboard/exams/examOptionUtils.js';

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

  if (!Array.isArray(raw.questions)) {
    return { valid: false, errorCode: 'INVALID_QUESTIONS', errorMessage: 'Danh sách câu hỏi questions phải là một mảng.' };
  }

  const validQuestions = [];
  const seenNumbers = new Set();
  const seenIds = new Set();

  for (let i = 0; i < raw.questions.length; i++) {
    const q = raw.questions[i];
    if (!isPlainObject(q)) {
      return { valid: false, errorCode: 'INVALID_QUESTION_ITEM', errorMessage: `Câu hỏi số ${i + 1} không đúng định dạng.` };
    }

    const qId = typeof q.id === 'string' && isValidUUID(q.id) ? q.id : null;
    if (!qId) {
      return { valid: false, errorCode: 'INVALID_QUESTION_ID', errorMessage: `Câu hỏi số ${i + 1} thiếu ID UUID hợp lệ.` };
    }
    if (seenIds.has(qId)) {
      return { valid: false, errorCode: 'DUPLICATE_QUESTION_ID', errorMessage: `Trùng lặp ID câu hỏi: ${qId}` };
    }
    seenIds.add(qId);

    const qNum = Number(q.question_number);
    if (!Number.isInteger(qNum) || qNum < 1) {
      return { valid: false, errorCode: 'INVALID_QUESTION_NUMBER', errorMessage: `Số thứ tự câu hỏi ${i + 1} không hợp lệ.` };
    }
    if (seenNumbers.has(qNum)) {
      return { valid: false, errorCode: 'DUPLICATE_QUESTION_NUMBER', errorMessage: `Trùng lặp số thứ tự câu hỏi: ${qNum}` };
    }
    seenNumbers.add(qNum);

    const qType = typeof q.question_type === 'string' ? q.question_type : '';
    const allowedTypes = ['single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload'];
    if (!allowedTypes.includes(qType)) {
      return { valid: false, errorCode: 'INVALID_QUESTION_TYPE', errorMessage: `Loại câu hỏi không hợp lệ: ${qType}` };
    }

    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
    if (!prompt) {
      return { valid: false, errorCode: 'INVALID_PROMPT', errorMessage: `Nội dung câu hỏi ${qNum} không được để trống.` };
    }

    const points = Number(q.points);
    if (isNaN(points) || points <= 0) {
      return { valid: false, errorCode: 'INVALID_POINTS', errorMessage: `Điểm số câu ${qNum} phải lớn hơn 0.` };
    }

    let validatedOptionsJson = [];
    let validatedAnswerKey = null;

    if (qType === 'single_choice' || qType === 'multiple_choice') {
      const rawOpts = q.options_json ?? q.options;
      if (!Array.isArray(rawOpts) || rawOpts.length < 2) {
        return {
          valid: false,
          errorCode: 'INVALID_OPTION_SCHEMA',
          errorMessage: `Câu hỏi trắc nghiệm ${qNum} phải có ít nhất 2 lựa chọn dạng mảng đối tượng {key, text}.`,
        };
      }

      const seenOptionKeys = new Set();
      for (let oIdx = 0; oIdx < rawOpts.length; oIdx++) {
        const opt = rawOpts[oIdx];
        if (!isPlainObject(opt)) {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Phương án ${oIdx + 1} của câu ${qNum} phải là đối tượng có thuộc tính 'key' và 'text'.`,
          };
        }

        const optKey = typeof opt.key === 'string' ? opt.key.trim() : '';
        if (!optKey) {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Thuộc tính 'key' của phương án ${oIdx + 1} câu ${qNum} không được để trống.`,
          };
        }

        if (seenOptionKeys.has(optKey)) {
          return {
            valid: false,
            errorCode: 'DUPLICATE_OPTION_KEY',
            errorMessage: `Trùng lặp key '${optKey}' trong các phương án của câu ${qNum}.`,
          };
        }
        seenOptionKeys.add(optKey);

        if (typeof opt.text !== 'string') {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Nội dung phương án '${optKey}' của câu ${qNum} phải là chuỗi văn bản (string).`,
          };
        }

        const trimmedText = opt.text.trim();
        if (!trimmedText) {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Nội dung phương án '${optKey}' của câu ${qNum} không được để trống hoặc chỉ chứa khoảng trắng.`,
          };
        }

        validatedOptionsJson.push({
          key: optKey,
          text: trimmedText,
        });
      }

      const rawAnsKey = q.answer_key ?? q.correct_answer_key ?? (q.correct_answer !== undefined ? { correct_answer: q.correct_answer } : null);
      if (!isPlainObject(rawAnsKey)) {
        return {
          valid: false,
          errorCode: 'INVALID_ANSWER_KEY',
          errorMessage: `Câu hỏi ${qNum} phải có cấu hình đáp án đúng (answer_key).`,
        };
      }

      if (qType === 'single_choice') {
        const correctAns = typeof rawAnsKey.correct_answer === 'string' ? rawAnsKey.correct_answer.trim() : '';
        if (!correctAns || !seenOptionKeys.has(correctAns)) {
          return {
            valid: false,
            errorCode: 'INVALID_ANSWER_KEY',
            errorMessage: `Đáp án đúng của câu ${qNum} ('${correctAns}') phải là một key hợp lệ tồn tại trong options_json.`,
          };
        }
        validatedAnswerKey = { correct_answer: correctAns };
      } else if (qType === 'multiple_choice') {
        const correctList = Array.isArray(rawAnsKey.correct_answer)
          ? rawAnsKey.correct_answer
          : (typeof rawAnsKey.correct_answer === 'string' ? [rawAnsKey.correct_answer] : []);

        if (correctList.length === 0) {
          return {
            valid: false,
            errorCode: 'INVALID_ANSWER_KEY',
            errorMessage: `Câu hỏi ${qNum} phải có ít nhất 1 đáp án đúng.`,
          };
        }
        for (const k of correctList) {
          if (typeof k !== 'string' || !seenOptionKeys.has(k.trim())) {
            return {
              valid: false,
              errorCode: 'INVALID_ANSWER_KEY',
              errorMessage: `Đáp án đúng '${k}' của câu ${qNum} không tồn tại trong options_json.`,
            };
          }
        }
        validatedAnswerKey = { correct_answer: correctList.map((k) => k.trim()) };
      }
    } else if (qType === 'fill_blank' || qType === 'short_answer') {
      validatedOptionsJson = [];
      const rawAnsKey = q.answer_key ?? q.correct_answer_key ?? (q.correct_answer !== undefined ? { correct_answer: q.correct_answer } : null);
      if (!isPlainObject(rawAnsKey) || rawAnsKey.correct_answer === undefined || rawAnsKey.correct_answer === null || String(rawAnsKey.correct_answer).trim() === '') {
        return {
          valid: false,
          errorCode: 'INVALID_ANSWER_KEY',
          errorMessage: `Câu hỏi ${qNum} phải có đáp án đúng.`,
        };
      }
      validatedAnswerKey = { correct_answer: String(rawAnsKey.correct_answer).trim() };
    } else {
      validatedOptionsJson = [];
      validatedAnswerKey = null;
    }

    validQuestions.push({
      id: qId,
      question_number: qNum,
      question_type: qType,
      prompt,
      points,
      options_json: validatedOptionsJson,
      answer_key: validatedAnswerKey,
    });
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
      questions: validQuestions,
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

function validateDeleteTestPayload(raw) {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }
  const rawExamId = raw.exam_id ?? raw.examId ?? raw.id;
  if (!rawExamId || typeof rawExamId !== 'string' || !isValidUUID(rawExamId)) {
    return { valid: false, errorCode: 'INVALID_EXAM_ID', errorMessage: 'Mã exam_id bắt buộc và phải đúng định dạng UUID.' };
  }
  return { valid: true, data: { exam_id: rawExamId.trim() } };
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
    let query = examClient.from('exam_tests').select('*').neq('status', 'archived');
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
        title: activeVersion?.title || t.title,
        subject: activeVersion?.subject || t.subject,
        grade_level: activeVersion?.grade_level || t.grade_level,
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

    const examId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '99999999-9999-4999-a999-000000000001';
    const versionId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '99999999-9999-4999-a999-000000000002';
    const rpcRes = await examClient.rpc('rpc_exam_create_test', {
      p_caller_id: callerId,
      p_exam_id: examId,
      p_version_id: versionId,
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

  // 9. POST /delete-test
  if (req.method === 'POST' && (action === 'delete-test' || action === 'delete')) {
    let rawBody;
    try { rawBody = await req.json(); } catch (_) { return createErrorResponse(400, 'INVALID_INPUT', 'JSON không hợp lệ.'); }
    const valResult = validateDeleteTestPayload(rawBody);
    if (!valResult.valid) return createErrorResponse(400, valResult.errorCode, valResult.errorMessage);

    const rpcRes = await examClient.rpc('rpc_exam_delete_or_archive_test', {
      p_caller_id: callerId,
      p_exam_id: valResult.data.exam_id,
      p_is_admin: actorRole === 'admin',
    });
    if (rpcRes.error) {
      const norm = normalizeRpcError(rpcRes.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }
    return createSuccessResponse(rpcRes.data, 200);
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
              neq: (col, val) => {
                filtered = filtered.filter((t) => t[col] !== val);
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
        const examId = args.p_exam_id || '99999999-9999-4999-a999-000000000001';
        const verId = args.p_version_id || '99999999-9999-4999-a999-000000000002';
        const newTest = {
          id: examId,
          author_id: args.p_caller_id,
          title: args.p_title,
          subject: args.p_subject,
          grade_level: args.p_grade_level,
          status: 'active',
          current_version_id: verId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const newVer = {
          id: verId,
          exam_id: examId,
          version_number: 1,
          title: args.p_title,
          subject: args.p_subject,
          grade_level: args.p_grade_level,
          description: args.p_description || null,
          duration_minutes: 45,
          status: 'draft',
        };
        examsDb.set(examId, newTest);
        versionsDb.set(verId, newVer);
        return {
          data: {
            exam_id: examId,
            version_id: verId,
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
        if (args.p_title) v.title = args.p_title;
        if (args.p_subject) v.subject = args.p_subject;
        if (args.p_grade_level) v.grade_level = args.p_grade_level;
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
      if (name === 'rpc_exam_delete_or_archive_test') {
        const test = examsDb.get(args.p_exam_id);
        if (!test) return { data: null, error: { message: 'ERR_EXAM_NOT_FOUND' } };
        if (!args.p_is_admin && test.author_id !== args.p_caller_id) {
          return { data: null, error: { message: 'ERR_UNAUTHORIZED' } };
        }
        if (test.status === 'archived') {
          return {
            data: {
              success: true,
              action: 'already_archived',
              exam_id: args.p_exam_id,
              message: 'Đề thi đã ở trạng thái lưu trữ từ trước.',
            },
            error: null,
          };
        }

        const examVersions = Array.from(versionsDb.values()).filter((v) => v.exam_id === args.p_exam_id);
        const hasPublished = examVersions.some((v) => v.status === 'published' || v.status === 'superseded');

        if (hasPublished) {
          test.status = 'archived';
          test.archived_at = new Date().toISOString();
          examVersions.filter((v) => v.status === 'draft').forEach((v) => { v.status = 'archived'; });
          return {
            data: {
              success: true,
              action: 'archived',
              exam_id: args.p_exam_id,
              message: 'Đề thi đã được lưu trữ an toàn; toàn bộ lịch sử giao bài và kết quả học sinh vẫn được bảo toàn nguyên vẹn.',
            },
            error: null,
          };
        } else {
          examVersions.forEach((v) => {
            versionsDb.delete(v.id);
          });
          examsDb.delete(args.p_exam_id);
          return {
            data: {
              success: true,
              action: 'deleted',
              exam_id: args.p_exam_id,
              message: 'Đề thi nháp đã được xóa vĩnh viễn thành công.',
            },
            error: null,
          };
        }
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

async function runRequest(action, method = 'GET', body = null, callerId = TEACHER_1_ID, queryParams = null, customEnv = null) {
  const env = customEnv || createMockEnvironment(callerId);
  const urlObj = new URL(`https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-management-api/${action}`);
  if (queryParams && typeof queryParams === 'object') {
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        urlObj.searchParams.set(k, String(v));
      }
    });
  }
  const req = new Request(urlObj.toString(), {
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
          options_json: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
            { key: 'C', text: '3' },
            { key: 'D', text: '4' },
          ],
          answer_key: { correct_answer: 'C' },
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
          options_json: [
            { key: 'A', text: '2' },
            { key: 'B', text: '3' },
            { key: 'C', text: '4' },
            { key: 'D', text: '5' },
          ],
          answer_key: { correct_answer: 'C' },
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

  await test('34. [CONTRACT] Migration 20260911000011 has ALL valid RAISE formats with matching placeholders', () => {
    const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260911000011_exam_builder_v1_phase_b1_draft_detail_rpc.sql');
    assert.equal(fs.existsSync(migrationPath), true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Extract all RAISE EXCEPTION statements
    const raiseRegex = /RAISE\s+EXCEPTION\s+('([^']*)'(?:\s*,\s*([^;]+?))?)\s+USING\s+ERRCODE/gi;
    let match;
    let count = 0;
    while ((match = raiseRegex.exec(sql)) !== null) {
      count++;
      const fullClause = match[1];
      const formatStr = match[2];
      const argsPart = match[3];

      // Count % placeholders in format string
      const placeholderCount = (formatStr.match(/%/g) || []).length;

      // Count arguments if present
      const argCount = argsPart ? argsPart.split(',').map(s => s.trim()).filter(Boolean).length : 0;

      assert.equal(
        placeholderCount,
        argCount,
        `RAISE EXCEPTION placeholder mismatch in migration: "${fullClause}". Placeholders: ${placeholderCount}, Args: ${argCount}`
      );
    }
    assert.ok(count >= 7, `Expected at least 7 RAISE EXCEPTION statements audited, found ${count}`);
  });

  await test('35. [CONTRACT] ExamEditorModal enforces persistent fail-closed gate on detail failure & preserves new exam flow', () => {
    const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamEditorModal.jsx');
    const code = fs.readFileSync(modalPath, 'utf8');

    // 1. Explicit load state
    assert.equal(code.includes("const [detailLoadStatus, setDetailLoadStatus] = useState('idle')"), true);

    // 2. New exam initialization sets ready
    assert.equal(code.includes("setDetailLoadStatus('ready')"), true);

    // 3. Existing exam sets loading, ready on success, failed on error
    assert.equal(code.includes("setDetailLoadStatus('loading')"), true);
    assert.equal(code.includes("setDetailLoadStatus('failed')"), true);

    // 4. Invariant: handleSaveDraft blocked when examToEdit && detailLoadStatus !== 'ready'
    assert.equal(code.includes("Boolean(examToEdit) && detailLoadStatus !== 'ready'"), true);

    // 5. Invariant: Save and Publish buttons disabled when detailLoadStatus !== 'ready'
    assert.equal(
      code.includes("disabled={loading || fetchingDetail || (Boolean(examToEdit) && detailLoadStatus !== 'ready')}"),
      true
    );

    // 6. Fail-closed UI banner rendered on failed state
    assert.equal(code.includes("Boolean(examToEdit) && detailLoadStatus === 'failed'"), true);
    assert.equal(code.includes('Khóa An Toàn / Fail-Closed'), true);
  });

  await test('36. [UX CONTRACT] ExamManagementTab disables edit button for published exams and renders "Đã Xuất Bản"', () => {
    const tabPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamManagementTab.jsx');
    const code = fs.readFileSync(tabPath, 'utf8');

    // Conditional render of disabled "Đã Xuất Bản" vs active "Chỉnh Sửa"
    assert.equal(code.includes('isPublished ? ('), true);
    assert.equal(code.includes('Đã Xuất Bản'), true);
    assert.equal(code.includes('Chỉnh Sửa'), true);
    assert.equal(code.includes('onClick={() => handleOpenEditModal(t)}'), true);
  });

  await test('37. [UX CONTRACT] ExamManagementTab guards handleOpenEditModal against published exams', () => {
    const tabPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamManagementTab.jsx');
    const code = fs.readFileSync(tabPath, 'utf8');

    assert.equal(code.includes("const isPublished = exam?.active_version?.status === 'published';"), true);
    assert.equal(code.includes("showToast('ℹ️ Đề thi đã xuất bản ở trạng thái bất biến, không thể chỉnh sửa trực tiếp.');"), true);
  });

  await test('38. [UX CONTRACT] ExamEditorModal removes misleading "bản nháp tiếp theo" text & guards against published version', () => {
    const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamEditorModal.jsx');
    const code = fs.readFileSync(modalPath, 'utf8');

    // Banned misleading text
    assert.equal(code.includes('bản nháp tiếp theo'), false);
    assert.equal(code.includes('Mọi chỉnh sửa và lưu nháp sẽ được áp dụng cho bản nháp tiếp theo'), false);

    // Accurate immutable notice present
    assert.equal(code.includes('Đề thi đã được xuất bản chính thức. Phiên bản này ở trạng thái bất biến và không thể chỉnh sửa trực tiếp.'), true);

    // useEffect guard for published exam
    assert.equal(code.includes("if (examToEdit.active_version?.status === 'published')"), true);

    // handleSaveDraft guard for published exam
    assert.equal(code.includes('if (isPublished) {'), true);
  });

  // 10. CHOICE OPTION SCHEMA MISMATCH & VALIDATION TESTS
  await test('39. [SCHEMA] save-draft rejects legacy plain string options with 400 INVALID_OPTION_SCHEMA', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Test Malformed Strings',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999993',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: ['1', '2', '3', '4'], // Legacy plain strings
          answer_key: { correct_answer: '2' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_OPTION_SCHEMA');
  });

  await test('40. [SCHEMA] save-draft rejects duplicate option keys with 400 DUPLICATE_OPTION_KEY', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Test Duplicate Keys',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999994',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: [
            { key: 'A', text: '1' },
            { key: 'A', text: '2' }, // Duplicate key
          ],
          answer_key: { correct_answer: 'A' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'DUPLICATE_OPTION_KEY');
  });

  await test('41. [SCHEMA] save-draft rejects correct_answer that does not exist in options_json keys', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Test Nonexistent Correct Answer',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999995',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
          ],
          answer_key: { correct_answer: 'Z' }, // Z does not exist
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_ANSWER_KEY');
  });

  await test('42. [SCHEMA] save-draft accepts canonical [{key, text}] schema with correct option key', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Chuẩn Canonical Options',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999996',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 5,
          options_json: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
            { key: 'C', text: '3' },
            { key: 'D', text: '4' },
          ],
          answer_key: { correct_answer: 'B' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
  });

  await test('43. [SCHEMA] save-draft accepts multiple_choice canonical schema with array of keys', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Chuẩn Multiple Choice',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999997',
          question_number: 1,
          question_type: 'multiple_choice',
          prompt: 'Chọn các số chẵn:',
          points: 5,
          options_json: [
            { key: 'A', text: '2' },
            { key: 'B', text: '3' },
            { key: 'C', text: '4' },
            { key: 'D', text: '5' },
          ],
          answer_key: { correct_answer: ['A', 'C'] },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
  });

  await test('44. [SCHEMA] save-draft accepts essay/upload questions without options or answer_key', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Tự Luận',
      subject: 'Tiếng Việt',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999998',
          question_number: 1,
          question_type: 'essay',
          prompt: 'Viết đoạn văn ngắn tả con mèo nhà em.',
          points: 10,
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 200);
    assert.equal(json.success, true);
  });

  await test('45. [CONTRACT] Real validation.ts strictly validates canonical {key, text} option objects and answer keys', () => {
    const valPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/validation.ts');
    const code = fs.readFileSync(valPath, 'utf8');

    assert.equal(code.includes('INVALID_OPTION_SCHEMA'), true);
    assert.equal(code.includes('DUPLICATE_OPTION_KEY'), true);
    assert.equal(code.includes('INVALID_ANSWER_KEY'), true);
    assert.equal(code.includes("typeof opt.key === 'string'"), true);
    assert.equal(code.includes('seenOptionKeys.has(correctAns)'), true);
    assert.equal(code.includes('seenOptionKeys.has(k.trim())'), true);
  });

  await test('46. [CONTRACT] Real handler.ts validates choice question options before calling rpc_exam_publish_version', () => {
    const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/handler.ts');
    const code = fs.readFileSync(handlerPath, 'utf8');

    assert.equal(code.includes('ERR_INVALID_OPTION_SCHEMA'), true);
    assert.equal(code.includes('options_json'), true);
    assert.equal(code.includes('rpc_exam_publish_version'), true);
  });

  // 11. OPTION DELETION REMAPPING & EMPTY TEXT VALIDATION TESTS
  await test('47. [REINDEX] Delete option BEFORE selected answer remaps correct key to old item content', () => {
    const initialOptions = [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
      { key: 'C', text: '3' }, // selected correct answer
      { key: 'D', text: '4' },
    ];
    // Delete A (index 0)
    const result = deleteSingleChoiceOption(initialOptions, 'C', 0);
    assert.equal(result.options.length, 3);
    assert.deepEqual(result.options, [
      { key: 'A', text: '2' },
      { key: 'B', text: '3' },
      { key: 'C', text: '4' },
    ]);
    assert.equal(result.correctKey, 'B'); // Old C ("3") is now B ("3")
  });

  await test('48. [REINDEX] Delete selected answer falls back safely to first remaining option', () => {
    const initialOptions = [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
      { key: 'C', text: '3' }, // selected correct answer
      { key: 'D', text: '4' },
    ];
    // Delete C (index 2)
    const result = deleteSingleChoiceOption(initialOptions, 'C', 2);
    assert.equal(result.options.length, 3);
    assert.deepEqual(result.options, [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
      { key: 'C', text: '4' },
    ]);
    assert.equal(result.correctKey, 'A'); // Explicit safe fallback to first option
  });

  await test('49. [REINDEX] Delete option AFTER selected answer keeps correct answer mapping', () => {
    const initialOptions = [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
      { key: 'C', text: '3' }, // selected correct answer
      { key: 'D', text: '4' },
    ];
    // Delete D (index 3)
    const result = deleteSingleChoiceOption(initialOptions, 'C', 3);
    assert.equal(result.options.length, 3);
    assert.deepEqual(result.options, [
      { key: 'A', text: '1' },
      { key: 'B', text: '2' },
      { key: 'C', text: '3' },
    ]);
    assert.equal(result.correctKey, 'C'); // Remains C ("3")
  });

  await test('50. [VALIDATION] Empty option text "" is REJECTED with 400 INVALID_OPTION_SCHEMA', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Test Empty Text',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999999',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: [
            { key: 'A', text: '' }, // empty text
            { key: 'B', text: '2' },
          ],
          answer_key: { correct_answer: 'B' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_OPTION_SCHEMA');
  });

  await test('51. [VALIDATION] Whitespace-only option text "   " is REJECTED with 400 INVALID_OPTION_SCHEMA', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Test Whitespace Text',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-99999999999a',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: [
            { key: 'A', text: '   ' }, // whitespace only
            { key: 'B', text: '2' },
          ],
          answer_key: { correct_answer: 'B' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_OPTION_SCHEMA');
  });

  await test('52. [VALIDATION] Non-string option text is REJECTED with 400 INVALID_OPTION_SCHEMA', async () => {
    const { status, json } = await runRequest('save-draft', 'POST', {
      version_id: VERSION_1_T1_DRAFT,
      title: 'Đề Test Non-String Text',
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-99999999999b',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: [
            { key: 'A', text: 123 }, // number instead of string
            { key: 'B', text: '2' },
          ],
          answer_key: { correct_answer: 'B' },
        },
      ],
    }, TEACHER_1_ID);
    assert.equal(status, 400);
    assert.equal(json.error_code, 'INVALID_OPTION_SCHEMA');
  });

  await test('53. [REGRESSION] Draft title persistence flow: rename to TEST-DRAFT-TITLE-01, save draft, and verify list/detail persistence', async () => {
    const env = createMockEnvironment(TEACHER_1_ID);

    // 1. Create a fresh draft exam with initial title = "Đề thi mới"
    const initialTitle = 'Đề thi mới';
    const { status: createStatus, json: createJson } = await runRequest('create-test', 'POST', {
      title: initialTitle,
      subject: 'Toán',
      grade_level: 1,
      description: 'Mô tả nháp ban đầu',
    }, TEACHER_1_ID, null, env);

    assert.equal(createStatus, 201);
    assert.equal(createJson.success, true);
    const newExamId = createJson.data.exam_id;
    const newVersionId = createJson.data.version_id;
    assert.ok(newExamId && newVersionId, 'create-test must return exam_id and version_id');

    // 2. Verify list-tests contains initial title
    const { status: listStatus1, json: listJson1 } = await runRequest('list-tests', 'GET', null, TEACHER_1_ID, null, env);
    assert.equal(listStatus1, 200);
    const initialExam = listJson1.data.tests.find((t) => t.id === newExamId);
    assert.ok(initialExam, 'Newly created exam must appear in list-tests');
    assert.equal(initialExam.title, initialTitle);
    assert.equal(initialExam.active_version.title, initialTitle);

    // 3. Perform Save Draft with new Title = "TEST-DRAFT-TITLE-01"
    const updatedTitle = 'TEST-DRAFT-TITLE-01';
    const { status: saveStatus, json: saveJson } = await runRequest('save-draft', 'POST', {
      version_id: newVersionId,
      title: updatedTitle,
      subject: 'Toán',
      grade_level: 1,
      questions: [
        {
          id: '99999999-9999-4999-a999-999999999991',
          question_number: 1,
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 10,
          options_json: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
          ],
          answer_key: { correct_answer: 'B' },
        },
      ],
    }, TEACHER_1_ID, null, env);

    assert.equal(saveStatus, 200);
    assert.equal(saveJson.data.status, 'draft');

    // 4. Verify list-tests endpoint returns new title
    const { status: listStatus2, json: listJson2 } = await runRequest('list-tests', 'GET', null, TEACHER_1_ID, null, env);
    assert.equal(listStatus2, 200);
    const updatedExam = listJson2.data.tests.find((t) => t.id === newExamId);
    assert.ok(updatedExam, 'Updated exam must exist');
    assert.equal(updatedExam.title, updatedTitle);
    assert.equal(updatedExam.active_version.title, updatedTitle);

    // 5. Verify get-test-detail endpoint returns new title in version
    const { status: detailStatus, json: detailJson } = await runRequest('get-test-detail', 'GET', null, TEACHER_1_ID, {
      exam_id: newExamId,
      version_id: newVersionId,
    }, env);
    assert.equal(detailStatus, 200);
    assert.equal(detailJson.data.version.title, updatedTitle);
  });

  await test('54. [CONTRACT] ExamEditorModal prioritizes active_version.title and synchronizes setTitle(v.title) upon getTestDetail', () => {
    const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamEditorModal.jsx');
    const code = fs.readFileSync(modalPath, 'utf8');

    // Invariant 1: initExistingExam prioritizes active_version.title
    assert.equal(code.includes("setTitle(activeV?.title || exam.title || '')"), true);
    assert.equal(code.includes("setSubject(activeV?.subject || exam.subject || 'Toán')"), true);
    assert.equal(code.includes("setGradeLevel(activeV?.grade_level || exam.grade_level || 1)"), true);

    // Invariant 2: getTestDetail success updates setTitle from v.title
    assert.equal(code.includes("setTitle(v.title || t?.title || exam.title || '')"), true);
    assert.equal(code.includes("setSubject(v.subject || t?.subject || exam.subject || 'Toán')"), true);
    assert.equal(code.includes("setGradeLevel(v.grade_level || t?.grade_level || exam.grade_level || 1)"), true);
  });

  await test('55. [CONTRACT] Real handler.ts maps activeVersion.title/subject/grade_level in list-tests', () => {
    const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/handler.ts');
    const code = fs.readFileSync(handlerPath, 'utf8');

    assert.equal(code.includes('title: activeVersion?.title || t.title'), true);
    assert.equal(code.includes('subject: activeVersion?.subject || t.subject'), true);
    assert.equal(code.includes('grade_level: activeVersion?.grade_level || t.grade_level'), true);
  });

  // --------------------------------------------------------------------------
  // SAFE DELETE EXAM TESTS (56-66)
  // --------------------------------------------------------------------------
  await test('56. Teacher can permanently delete (hard-delete) own clean draft exam', async () => {
    const env = createMockEnvironment(TEACHER_2_ID);
    // EXAM_2_T2 is a clean draft (never published) created by TEACHER_2_ID
    const { status, json } = await runRequest('delete-test', 'POST', {
      exam_id: EXAM_2_T2,
    }, TEACHER_2_ID, null, env);

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.action, 'deleted');

    // Verify exam is completely removed from DB
    const { status: listStatus, json: listJson } = await runRequest('list-tests', 'GET', null, TEACHER_2_ID, null, env);
    assert.equal(listStatus, 200);
    const found = listJson.data.tests.find((t) => t.id === EXAM_2_T2);
    assert.equal(found, undefined, 'Hard-deleted draft must not exist in list-tests');
  });

  await test('57. Teacher 1 attempting to delete Teacher 2 exam is REJECTED with 403 ERR_UNAUTHORIZED', async () => {
    const env = createMockEnvironment(TEACHER_1_ID);
    // Teacher 1 tries to delete EXAM_2_T2 (authored by Teacher 2)
    const { status, json } = await runRequest('delete-test', 'POST', {
      exam_id: EXAM_2_T2,
    }, TEACHER_1_ID, null, env);

    assert.equal(status, 403);
    assert.equal(json.error_code, 'ERR_UNAUTHORIZED');
  });

  await test('58. Student role calling delete-test is BLOCKED with 403 FORBIDDEN_ROLE', async () => {
    const env = createMockEnvironment(STUDENT_ID);
    const { status, json } = await runRequest('delete-test', 'POST', {
      exam_id: EXAM_1_T1,
    }, STUDENT_ID, null, env);

    assert.equal(status, 403);
    assert.equal(json.error_code, 'FORBIDDEN_ROLE');
  });

  await test('59. Admin can delete any teacher clean draft exam', async () => {
    const env = createMockEnvironment(ADMIN_ID);
    const { status, json } = await runRequest('delete-test', 'POST', {
      exam_id: EXAM_2_T2,
    }, ADMIN_ID, null, env);

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.action, 'deleted');
  });

  await test('60. Exam with published versions/attempts is SOFT-DELETED (Archived), preserving all historical records', async () => {
    const env = createMockEnvironment(TEACHER_1_ID);
    // EXAM_1_T1 has a published version (VERSION_1_T1_PUB)
    const { status, json } = await runRequest('delete-test', 'POST', {
      exam_id: EXAM_1_T1,
    }, TEACHER_1_ID, null, env);

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.action, 'archived');

    // Default GET list-tests must exclude archived exam
    const { status: listStatus, json: listJson } = await runRequest('list-tests', 'GET', null, TEACHER_1_ID, null, env);
    assert.equal(listStatus, 200);
    const foundInActiveList = listJson.data.tests.find((t) => t.id === EXAM_1_T1);
    assert.equal(foundInActiveList, undefined, 'Archived exam must be filtered out from default list-tests');
  });

  await test('61. Repeated delete call on already-archived exam is idempotent and returns already_archived', async () => {
    const env = createMockEnvironment(TEACHER_1_ID);
    // First call archives
    await runRequest('delete-test', 'POST', { exam_id: EXAM_1_T1 }, TEACHER_1_ID, null, env);

    // Second call
    const { status, json } = await runRequest('delete-test', 'POST', { exam_id: EXAM_1_T1 }, TEACHER_1_ID, null, env);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.action, 'already_archived');
  });

  await test('62. Delete non-existent exam returns 404 ERR_NOT_FOUND', async () => {
    const env = createMockEnvironment(TEACHER_1_ID);
    const { status, json } = await runRequest('delete-test', 'POST', {
      exam_id: '99999999-9999-4999-a999-999999999999',
    }, TEACHER_1_ID, null, env);

    assert.equal(status, 404);
    assert.equal(json.error_code, 'ERR_NOT_FOUND');
  });

  await test('63. Client SDK deleteTest method dispatches POST /delete-test with sanitized payload', async () => {
    let interceptedReq = null;
    const mockClient = createExamManagementClient({
      invokeFunction: async (params) => {
        interceptedReq = params;
        return {
          ok: true,
          data: { action: 'deleted', exam_id: EXAM_1_T1 },
        };
      },
    });

    const res = await mockClient.deleteTest({ examId: EXAM_1_T1 });
    assert.equal(res.ok, true);
    assert.equal(res.data.action, 'deleted');
    assert.equal(interceptedReq.action, 'delete-test');
    assert.equal(interceptedReq.method, 'POST');
    assert.deepEqual(interceptedReq.payload, { exam_id: EXAM_1_T1 });
  });

  await test('64. [CONTRACT] Migration 20260913000013 defines rpc_exam_delete_or_archive_test with safe FK breakdown & search_path', () => {
    const migPath = path.resolve(__dirname, '../supabase/migrations/20260913000013_exam_builder_v1_safe_delete_or_archive_rpc.sql');
    assert.equal(fs.existsSync(migPath), true, 'Migration 20260913000013 must exist');
    const sql = fs.readFileSync(migPath, 'utf8');

    assert.equal(sql.includes('CREATE OR REPLACE FUNCTION public.rpc_exam_delete_or_archive_test'), true);
    assert.equal(sql.includes('SET search_path = public, app_private'), true);
    assert.equal(sql.includes('SECURITY DEFINER'), true);
    // Break circular FK
    assert.equal(sql.includes('UPDATE public.exam_tests\n        SET current_version_id = NULL'), true);
    // Delete answer keys & questions
    assert.equal(sql.includes('DELETE FROM app_private.exam_answer_keys'), true);
    assert.equal(sql.includes('DELETE FROM public.exam_questions'), true);
    assert.equal(sql.includes('DELETE FROM public.exam_versions'), true);
    assert.equal(sql.includes('DELETE FROM public.exam_tests'), true);
    // Soft delete / archive
    assert.equal(sql.includes("UPDATE public.exam_tests\n        SET status = 'archived'"), true);
    // Security grants
    assert.equal(sql.includes('REVOKE ALL ON FUNCTION public.rpc_exam_delete_or_archive_test'), true);
    assert.equal(sql.includes('GRANT EXECUTE ON FUNCTION public.rpc_exam_delete_or_archive_test'), true);
  });

  await test('65. [CONTRACT] Real handler.ts handles POST /delete-test and filters out archived exams from GET /list-tests', () => {
    const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-management-api/handler.ts');
    const code = fs.readFileSync(handlerPath, 'utf8');

    assert.equal(code.includes("action === 'delete-test' || action === 'delete'"), true);
    assert.equal(code.includes('rpc_exam_delete_or_archive_test'), true);
    assert.equal(code.includes(".neq('status', 'archived')"), true);
  });

  await test('66. [UX CONTRACT] ExamManagementTab renders Delete action button and confirmation modal with safety warnings', () => {
    const tabPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamManagementTab.jsx');
    const code = fs.readFileSync(tabPath, 'utf8');

    // Delete button presence in table
    assert.equal(code.includes('handleOpenDeleteModal(t)'), true);
    assert.equal(code.includes('Trash2'), true);

    // Modal safety messages & double click protection
    assert.equal(code.includes('Xác Nhận Xóa Vĩnh Viễn'), true);
    assert.equal(code.includes('Lưu Trữ Đề Kiểm Tra (Archive)'), true);
    assert.equal(code.includes('Bảo toàn kết quả và lịch sử bài làm học sinh'), true);
    assert.equal(code.includes('isDeleting'), true);
    assert.equal(code.includes('Loader2'), true);
  });

  console.log('\n======================================================================');
  console.log(`TOTAL MANAGEMENT TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllManagementTests();


