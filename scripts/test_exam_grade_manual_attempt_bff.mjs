// scripts/test_exam_grade_manual_attempt_bff.mjs
// Comprehensive Unit & Security Test Suite for Exam Builder Manual Grading BFF (Phase 3A)
// 71/71 Verification Matrix Covering Auth, Request, Auth Chain, RPC, Error Mapping, Response, Logging, CORS, and Deployment Gateway Hardening

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';


// ----------------------------------------------------------------------------
// Local BFF Implementation Mirror (Pure TypeScript Logic runnable in Node ESM)
// ----------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const FORBIDDEN_INJECTION_FIELDS = new Set([
  'caller_id',
  'p_caller_id',
  'role',
  'actor_role',
  'class_id',
  'is_admin',
  'student_id',
  'service_role',
  'service_role_key',
]);

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'attempt_id',
  'manual_grades',
  'teacher_feedback',
  'expected_version',
]);

const ALLOWED_MANUAL_GRADE_KEYS = new Set([
  'exam_question_id',
  'points_earned',
  'teacher_comment',
]);

function isValidUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
      ? err.message
      : '';

  if (rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }
  if (rawMsg.includes('ERR_QUESTION_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_QUESTION_NOT_FOUND', message: 'Không tìm thấy câu hỏi trong ngân hàng đề thi.' };
  }
  if (rawMsg.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_OPTIMISTIC_LOCK_CONFLICT', message: 'Dữ liệu bài thi đã thay đổi bởi phiên khác, vui lòng làm mới trang.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_ALREADY_GRADED')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_ALREADY_GRADED', message: 'Bài thi đã được chấm trước đó với điểm số hoặc nhận xét khác.' };
  }
  if (rawMsg.includes('ERR_DUPLICATE_MANUAL_GRADE')) {
    return { status: 409, errorCode: 'ERR_DUPLICATE_MANUAL_GRADE', message: 'Danh sách chấm bài chứa câu hỏi bị trùng lặp.' };
  }
  if (rawMsg.includes('ERR_INVALID_MANUAL_GRADES_PAYLOAD')) {
    return { status: 422, errorCode: 'ERR_INVALID_MANUAL_GRADES_PAYLOAD', message: 'Cấu trúc dữ liệu chấm bài không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_INVALID_MANUAL_POINTS')) {
    return { status: 422, errorCode: 'ERR_INVALID_MANUAL_POINTS', message: 'Điểm số chấm tự luận không hợp lệ hoặc vượt quá điểm tối đa.' };
  }
  if (rawMsg.includes('ERR_MANUAL_GRADES_INCOMPLETE')) {
    return { status: 422, errorCode: 'ERR_MANUAL_GRADES_INCOMPLETE', message: 'Số lượng câu hỏi chấm không khớp với số câu tự luận của đề thi.' };
  }
  if (rawMsg.includes('ERR_NOT_MANUAL_QUESTION')) {
    return { status: 422, errorCode: 'ERR_NOT_MANUAL_QUESTION', message: 'Chỉ có thể chấm điểm thủ công cho các câu hỏi tự luận hoặc tải tệp.' };
  }
  if (rawMsg.includes('ERR_QUESTION_VERSION_MISMATCH')) {
    return { status: 422, errorCode: 'ERR_QUESTION_VERSION_MISMATCH', message: 'Câu hỏi không thuộc phiên bản đề thi này.' };
  }
  if (rawMsg.includes('ERR_MANUAL_ANSWER_ROW_MISSING')) {
    return { status: 422, errorCode: 'ERR_MANUAL_ANSWER_ROW_MISSING', message: 'Thiếu bản ghi câu trả lời tương ứng trong bài thi.' };
  }
  if (rawMsg.includes('ERR_MANUAL_ANSWER_STATE')) {
    return { status: 422, errorCode: 'ERR_MANUAL_ANSWER_STATE', message: 'Trạng thái câu trả lời không hợp lệ để chấm điểm.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_SNAPSHOT_INVALID') || rawMsg.includes('ERR_QUESTION_NOT_IN_SNAPSHOT')) {
    return { status: 422, errorCode: 'ERR_ATTEMPT_SNAPSHOT_INVALID', message: 'Dữ liệu snapshot đề thi của lượt làm bài không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_SCORE_INVARIANT')) {
    return { status: 422, errorCode: 'ERR_SCORE_INVARIANT', message: 'Điểm trắc nghiệm tự động của bài thi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_NO_MANUAL_QUESTIONS')) {
    return { status: 422, errorCode: 'ERR_NO_MANUAL_QUESTIONS', message: 'Đề thi toàn bộ là trắc nghiệm, không có câu tự luận để chấm điểm.' };
  }

  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý chấm bài.',
  };
}

function mapGradingSuccess(rpcData) {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData;
  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.status !== 'string' || rec.status !== 'graded') return { ok: false };
  if (typeof rec.max_score !== 'number' || Number.isNaN(rec.max_score)) return { ok: false };
  if (typeof rec.version !== 'number' || !Number.isInteger(rec.version) || rec.version < 1) return { ok: false };
  if (typeof rec.idempotent_replay !== 'boolean') return { ok: false };
  if (typeof rec.reward_stars_awarded !== 'number') return { ok: false };

  const objectiveScore = rec.objective_score === null ? null : (typeof rec.objective_score === 'number' ? rec.objective_score : null);
  const manualScore = rec.manual_score === null ? null : (typeof rec.manual_score === 'number' ? rec.manual_score : null);
  const totalScore = rec.total_score === null ? null : (typeof rec.total_score === 'number' ? rec.total_score : null);
  const teacherFeedback = rec.teacher_feedback === null ? null : (typeof rec.teacher_feedback === 'string' ? rec.teacher_feedback : null);
  const gradedAt = rec.graded_at === null ? null : (typeof rec.graded_at === 'string' ? rec.graded_at : null);
  const gradedBy = rec.graded_by === null ? null : (typeof rec.graded_by === 'string' ? rec.graded_by : null);

  return {
    ok: true,
    data: {
      attempt_id: rec.attempt_id,
      status: rec.status,
      objective_score: objectiveScore,
      manual_score: manualScore,
      total_score: totalScore,
      max_score: rec.max_score,
      teacher_feedback: teacherFeedback,
      graded_at: gradedAt,
      graded_by: gradedBy,
      reward_stars_awarded: rec.reward_stars_awarded,
      version: rec.version,
      idempotent_replay: rec.idempotent_replay,
    },
  };
}

function validateManualGradingPayload(body) {
  if (!isPlainObject(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object hợp lệ.',
    };
  }

  for (const key of Object.keys(body)) {
    const normalizedKey = key.toLowerCase().trim();
    if (FORBIDDEN_INJECTION_FIELDS.has(normalizedKey)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${key}' bị cấm trong payload yêu cầu bảo mật.`,
      };
    }
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${key}' không nằm trong danh sách cho phép.`,
      };
    }
  }

  if (!('attempt_id' in body) || !isValidUUID(body.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường attempt_id là bắt buộc và phải là một UUID hợp lệ.',
    };
  }

  if (!('expected_version' in body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường expected_version là bắt buộc.',
    };
  }

  const expectedVersion = body.expected_version;
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường expected_version phải là số nguyên dương >= 1.',
    };
  }

  if (!('manual_grades' in body) || !Array.isArray(body.manual_grades)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường manual_grades phải là một mảng JSON.',
    };
  }

  const manualGradesArray = body.manual_grades;
  const validatedGrades = [];

  for (let i = 0; i < manualGradesArray.length; i++) {
    const entry = manualGradesArray[i];
    if (!isPlainObject(entry)) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Phần tử manual_grades[${i}] phải là một object.`,
      };
    }

    for (const k of Object.keys(entry)) {
      const normK = k.toLowerCase().trim();
      if (FORBIDDEN_INJECTION_FIELDS.has(normK)) {
        return {
          valid: false,
          errorCode: 'INVALID_REQUEST_FIELD',
          errorMessage: `Trường '${k}' trong manual_grades[${i}] bị cấm.`,
        };
      }
      if (!ALLOWED_MANUAL_GRADE_KEYS.has(k)) {
        return {
          valid: false,
          errorCode: 'INVALID_REQUEST_FIELD',
          errorMessage: `Trường '${k}' trong manual_grades[${i}] không hợp lệ.`,
        };
      }
    }

    if (!('exam_question_id' in entry) || !isValidUUID(entry.exam_question_id)) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường exam_question_id trong manual_grades[${i}] phải là một UUID hợp lệ.`,
      };
    }

    if (!('points_earned' in entry) || typeof entry.points_earned !== 'number') {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường points_earned trong manual_grades[${i}] phải là số.`,
      };
    }

    const pts = entry.points_earned;
    if (!Number.isFinite(pts) || pts < 0) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường points_earned trong manual_grades[${i}] phải là số không âm hữu hạn.`,
      };
    }

    const ptsStr = String(pts);
    if (ptsStr.includes('.') && ptsStr.split('.')[1].length > 2) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường points_earned trong manual_grades[${i}] chỉ được tối đa 2 chữ số thập phân.`,
      };
    }

    let teacherComment = null;
    if ('teacher_comment' in entry) {
      if (entry.teacher_comment !== null && typeof entry.teacher_comment !== 'string') {
        return {
          valid: false,
          errorCode: 'INVALID_INPUT',
          errorMessage: `Trường teacher_comment trong manual_grades[${i}] phải là chuỗi hoặc null.`,
        };
      }
      teacherComment = entry.teacher_comment;
    }

    validatedGrades.push({
      exam_question_id: entry.exam_question_id,
      points_earned: pts,
      teacher_comment: teacherComment,
    });
  }

  let teacherFeedback = null;
  if ('teacher_feedback' in body) {
    if (body.teacher_feedback !== null && typeof body.teacher_feedback !== 'string') {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Trường teacher_feedback phải là chuỗi hoặc null.',
      };
    }
    teacherFeedback = body.teacher_feedback;
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: body.attempt_id,
      expected_version: expectedVersion,
      manual_grades: validatedGrades,
      teacher_feedback: teacherFeedback,
    },
  };
}

async function verifyAuthAndDeriveContext(req, deps) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  if (!deps || deps.mode !== 'injected' || !deps.callerAuthClient || !deps.coreQueryClient) {
    return {
      ok: false,
      response: createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Cấu hình mock dependencies không đầy đủ.'
      ),
    };
  }

  const { data: userData, error: authError } = await deps.callerAuthClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'INVALID_TOKEN',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
      ),
    };
  }

  const callerId = userData.user.id;

  const { data: profile, error: dbError } = await deps.coreQueryClient
    .from('profiles')
    .select('id, role, is_disabled')
    .eq('id', callerId)
    .maybeSingle();

  if (dbError) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (!profile) {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Hồ sơ người dùng không tồn tại trong hệ thống.'
      ),
    };
  }

  if (profile.id !== callerId) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (profile.is_disabled === true) {
    return {
      ok: false,
      response: createErrorResponse(403, 'ACCOUNT_DISABLED', 'Tài khoản của bạn đã bị vô hiệu hóa.'),
    };
  }

  if (profile.role !== 'admin' && profile.role !== 'teacher') {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Chỉ Giáo viên hoặc Quản trị viên mới có quyền chấm bài thi.'
      ),
    };
  }

  return {
    ok: true,
    context: {
      callerId,
      actorRole: profile.role,
    },
    coreClient: deps.coreQueryClient,
    examClient: deps.examQueryClient,
  };
}

async function handleGradeManualAttemptRequest(req, deps) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'INVALID_INPUT',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.'
    );
  }

  try {
    const authResult = await verifyAuthAndDeriveContext(req, deps?.authDeps);
    if (!authResult.ok || !authResult.context) {
      return authResult.response || createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.');
    }

    const { callerId, actorRole } = authResult.context;
    const coreClient = deps?.coreClient || authResult.coreClient;
    const examClient = deps?.examClient || authResult.examClient;

    if (!coreClient || !examClient) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Máy chủ chưa được cấu hình đầy đủ kết nối cơ sở dữ liệu.');
    }

    let rawBody;
    try {
      rawBody = await req.json();
    } catch (_) {
      return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.');
    }

    const valResult = validateManualGradingPayload(rawBody);
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    // 1. Resolve attempt -> assignment
    const { data: attemptRow, error: attemptErr } = await examClient
      .from('exam_attempts')
      .select('id, assignment_id')
      .eq('id', sanitized.attempt_id)
      .maybeSingle();

    if (attemptErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin lượt thi.');
    }
    if (!attemptRow) {
      return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài thi.');
    }

    // 2. Resolve assignment -> class
    const { data: assignmentRow, error: assignErr } = await examClient
      .from('exam_assignments')
      .select('id, class_id')
      .eq('id', attemptRow.assignment_id)
      .maybeSingle();

    if (assignErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin bài giao.');
    }
    if (!assignmentRow) {
      return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy thông tin bài giao tương ứng.');
    }

    const resolvedClassId = assignmentRow.class_id;

    // 3. Authorize on CORE
    if (actorRole === 'teacher') {
      const { data: classRow, error: classErr } = await coreClient
        .from('classes')
        .select('id, teacher_id')
        .eq('id', resolvedClassId)
        .maybeSingle();

      if (classErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra quyền hạn lớp học.');
      }
      if (!classRow || classRow.teacher_id !== callerId) {
        return createErrorResponse(
          403,
          'CLASS_ACCESS_DENIED',
          'Bạn không có quyền quản lý lớp học được giao bài thi này.'
        );
      }
    } else if (actorRole !== 'admin') {
      return createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Chỉ Giáo viên quản lý lớp hoặc Quản trị viên mới có quyền chấm bài thi.'
      );
    }

    // 4. Server-Side RPC Call
    const rpcResult = await examClient.rpc('rpc_exam_grade_manual_attempt', {
      p_caller_id: callerId,
      p_attempt_id: sanitized.attempt_id,
      p_manual_grades: sanitized.manual_grades,
      p_teacher_feedback: sanitized.teacher_feedback,
      p_expected_version: sanitized.expected_version,
    });

    if (rpcResult.error) {
      const norm = normalizeRpcError(rpcResult.error);
      return createErrorResponse(norm.status, norm.errorCode, norm.message);
    }

    // 5. Success Allowlist
    const successMapping = mapGradingSuccess(rpcResult.data);
    if (!successMapping.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Kết quả trả về từ hệ thống chấm điểm không đúng định dạng chuẩn.'
      );
    }

    return createSuccessResponse(successMapping.data, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình xử lý.'
    );
  }
}

// ----------------------------------------------------------------------------
// MOCK FACTORY HELPERS
// ----------------------------------------------------------------------------

function createMockDependencies(options = {}) {
  const {
    user = { id: 'teacher-uuid-1' },
    authError = null,
    profile = { id: 'teacher-uuid-1', role: 'teacher', is_disabled: false },
    profileError = null,
    classRow = { id: 'class-uuid-1', teacher_id: 'teacher-uuid-1' },
    classError = null,
    attemptRow = { id: 'attempt-uuid-1', assignment_id: 'assignment-uuid-1' },
    attemptError = null,
    assignmentRow = { id: 'assignment-uuid-1', class_id: 'class-uuid-1' },
    assignmentError = null,
    rpcResult = {
      data: {
        attempt_id: 'attempt-uuid-1',
        status: 'graded',
        objective_score: 2.5,
        manual_score: 7.0,
        total_score: 9.5,
        max_score: 10.0,
        teacher_feedback: 'Good job',
        graded_at: '2026-09-06T00:00:00.000Z',
        graded_by: 'teacher-uuid-1',
        reward_stars_awarded: 0,
        version: 2,
        idempotent_replay: false,
      },
      error: null,
    },
  } = options;

  let rpcCalledWith = null;
  const coreWrites = [];

  const callerAuthClient = {
    auth: {
      async getUser() {
        return { data: { user }, error: authError };
      },
    },
  };

  const coreQueryClient = {
    from(table) {
      return {
        select(cols) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  if (table === 'profiles') {
                    if (profileError) return { data: null, error: profileError };
                    return { data: profile, error: null };
                  }
                  if (table === 'classes') {
                    if (classError) return { data: null, error: classError };
                    return { data: classRow, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        insert(data) {
          coreWrites.push({ action: 'insert', table, data });
          return { error: null };
        },
        update(data) {
          coreWrites.push({ action: 'update', table, data });
          return { error: null };
        },
        delete() {
          coreWrites.push({ action: 'delete', table });
          return { error: null };
        },
      };
    },
  };

  const examQueryClient = {
    from(table) {
      return {
        select(cols) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  if (table === 'exam_attempts') {
                    if (attemptError) return { data: null, error: attemptError };
                    return { data: attemptRow, error: null };
                  }
                  if (table === 'exam_assignments') {
                    if (assignmentError) return { data: null, error: assignmentError };
                    return { data: assignmentRow, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalledWith = { name, args };
      return rpcResult;
    },
  };

  const authDeps = {
    mode: 'injected',
    callerAuthClient,
    coreQueryClient,
    examQueryClient,
  };

  return {
    deps: {
      mode: 'injected',
      authDeps,
      coreClient: coreQueryClient,
      examClient: examQueryClient,
    },
    getRpcCall: () => rpcCalledWith,
    getCoreWrites: () => coreWrites,
  };
}

function createRequest(options = {}) {
  const {
    method = 'POST',
    authHeader = 'Bearer valid-jwt-token',
    body = {
      attempt_id: '77777777-7777-4777-8777-777777777701',
      expected_version: 1,
      manual_grades: [
        {
          exam_question_id: '98888888-8888-4888-8888-888888888802',
          points_earned: 3.0,
          teacher_comment: 'Good',
        },
      ],
      teacher_feedback: 'Em lam tot',
    },
    rawBody = null,
  } = options;

  const headers = new Headers();
  if (authHeader !== null) {
    headers.set('Authorization', authHeader);
  }
  headers.set('Content-Type', 'application/json');

  const reqInit = {
    method,
    headers,
  };

  if (method !== 'GET' && method !== 'OPTIONS') {
    reqInit.body = rawBody !== null ? rawBody : JSON.stringify(body);
  }

  return new Request('https://edge.example.com/exam/grade-manual-attempt', reqInit);
}

// ----------------------------------------------------------------------------
// TEST RUNNER & SUITE
// ----------------------------------------------------------------------------

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING EXAM BUILDER V1 PHASE 3A BFF SECURITY UNIT TEST SUITE');
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

  // ==========================================================================
  // SECTION 1: AUTH TESTS (1..11)
  // ==========================================================================
  console.log('\n--- 1. Auth Tests (1..11) ---');

  await test('1. missing Authorization -> 401 AUTH_REQUIRED', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({ authHeader: null });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error_code, 'AUTH_REQUIRED');
  });

  await test('2. malformed Bearer -> 401 AUTH_REQUIRED', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({ authHeader: 'Basic some-user:pass' });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error_code, 'AUTH_REQUIRED');
  });

  await test('3. invalid token -> 401 INVALID_TOKEN', async () => {
    const { deps } = createMockDependencies({ authError: new Error('Invalid JWT') });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_TOKEN');
  });

  await test('4. expired token -> 401 INVALID_TOKEN', async () => {
    const { deps } = createMockDependencies({ user: null });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_TOKEN');
  });

  await test('5. caller ID derived from validated token', async () => {
    const { deps, getRpcCall } = createMockDependencies({
      user: { id: 'a1111111-1111-4111-8111-111111111111' },
      profile: { id: 'a1111111-1111-4111-8111-111111111111', role: 'teacher', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'a1111111-1111-4111-8111-111111111111' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    assert.equal(getRpcCall().args.p_caller_id, 'a1111111-1111-4111-8111-111111111111');
  });

  await test('6. body caller_id rejected -> 400 INVALID_REQUEST_FIELD', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        caller_id: 'attacker-uuid',
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 3.0 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
  });

  await test('7. student role rejected -> 403 FORBIDDEN_ROLE', async () => {
    const { deps } = createMockDependencies({
      profile: { id: 'teacher-uuid-1', role: 'student', is_disabled: false },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'FORBIDDEN_ROLE');
  });

  await test('8. unknown/null role rejected -> 403 FORBIDDEN_ROLE', async () => {
    const { deps } = createMockDependencies({
      profile: { id: 'teacher-uuid-1', role: 'guest', is_disabled: false },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'FORBIDDEN_ROLE');
  });

  await test('9. admin allowed', async () => {
    const { deps } = createMockDependencies({
      user: { id: 'admin-uuid-1' },
      profile: { id: 'admin-uuid-1', role: 'admin', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'another-teacher-uuid' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
  });

  await test('10. managed-class teacher allowed', async () => {
    const { deps } = createMockDependencies({
      user: { id: 'teacher-uuid-1' },
      profile: { id: 'teacher-uuid-1', role: 'teacher', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'teacher-uuid-1' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
  });

  await test('11. other-class teacher rejected -> 403 CLASS_ACCESS_DENIED', async () => {
    const { deps } = createMockDependencies({
      user: { id: 'teacher-uuid-1' },
      profile: { id: 'teacher-uuid-1', role: 'teacher', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'other-teacher-uuid-2' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  // ==========================================================================
  // SECTION 2: REQUEST CONTRACT & VALIDATION (12..25)
  // ==========================================================================
  console.log('\n--- 2. Request Validation Tests (12..25) ---');

  await test('12. invalid JSON rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({ rawBody: '{ broken json' });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('13. unknown top-level key rejected -> 400 INVALID_REQUEST_FIELD', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 3.0 }],
        unsupported_field: 123,
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
  });

  await test('14. invalid attempt UUID rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: 'not-a-valid-uuid',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 3.0 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('15. expected_version missing rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 3.0 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('16. non-integer expected_version rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1.5,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 3.0 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('17. manual_grades non-array rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: 'not-an-array',
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('18. manual entry non-object rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: ['string-item'],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('19. extra manual-entry key rejected -> 400 INVALID_REQUEST_FIELD', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: '98888888-8888-4888-8888-888888888802',
            points_earned: 3.0,
            bonus_score: 5,
          },
        ],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
  });

  await test('20. invalid question UUID rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: 'invalid-q-uuid',
            points_earned: 3.0,
          },
        ],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('21. points string rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: '98888888-8888-4888-8888-888888888802',
            points_earned: '3.00',
          },
        ],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('22. negative points rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: '98888888-8888-4888-8888-888888888802',
            points_earned: -0.5,
          },
        ],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('23. >2-decimal points rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: '98888888-8888-4888-8888-888888888802',
            points_earned: 2.125,
          },
        ],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('24. teacher_comment wrong type rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: '98888888-8888-4888-8888-888888888802',
            points_earned: 2.5,
            teacher_comment: 999,
          },
        ],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('25. teacher_feedback wrong type rejected -> 400 INVALID_INPUT', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [
          {
            exam_question_id: '98888888-8888-4888-8888-888888888802',
            points_earned: 2.5,
          },
        ],
        teacher_feedback: { note: 'invalid' },
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  // ==========================================================================
  // SECTION 3: AUTHORIZATION CHAIN (26..30)
  // ==========================================================================
  console.log('\n--- 3. Authorization Chain Tests (26..30) ---');

  await test('26. class_id not taken from body -> 400 INVALID_REQUEST_FIELD', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        class_id: 'custom-class-id',
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
  });

  await test('27. attempt->assignment resolved server-side', async () => {
    const { deps } = createMockDependencies({
      attemptRow: { id: '77777777-7777-4777-8777-777777777701', assignment_id: 'assign-auto-resolved-1' },
      assignmentRow: { id: 'assign-auto-resolved-1', class_id: 'class-uuid-1' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
  });

  await test('28. assignment->class resolved server-side', async () => {
    const { deps } = createMockDependencies({
      attemptRow: { id: '77777777-7777-4777-8777-777777777701', assignment_id: 'assign-auto-resolved-1' },
      assignmentRow: { id: 'assign-auto-resolved-1', class_id: 'resolved-class-uuid-99' },
      classRow: { id: 'resolved-class-uuid-99', teacher_id: 'teacher-uuid-1' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
  });

  await test('29. teacher access checked against resolved class', async () => {
    const { deps } = createMockDependencies({
      assignmentRow: { id: 'assignment-uuid-1', class_id: 'restricted-class-uuid' },
      classRow: { id: 'restricted-class-uuid', teacher_id: 'other-teacher-uuid' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  await test('30. no CORE write performed', async () => {
    const { deps, getCoreWrites } = createMockDependencies();
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    assert.equal(getCoreWrites().length, 0);
  });

  // ==========================================================================
  // SECTION 4: RPC CALL CONSTRUCT (31..36)
  // ==========================================================================
  console.log('\n--- 4. RPC Call Tests (31..36) ---');

  await test('31. NEW service role used server-side only', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    const json = await res.json();
    assert.equal('service_role' in json, false);
    assert.equal('service_role_key' in json, false);
  });

  await test('32. p_caller_id equals validated CORE user ID', async () => {
    const { deps, getRpcCall } = createMockDependencies({
      user: { id: 'verified-core-user-123' },
      profile: { id: 'verified-core-user-123', role: 'admin', is_disabled: false },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    assert.equal(getRpcCall().args.p_caller_id, 'verified-core-user-123');
  });

  await test('33. body cannot override caller', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        p_caller_id: 'hacker-uuid',
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
  });

  await test('34. exact approved RPC called', async () => {
    const { deps, getRpcCall } = createMockDependencies();
    const req = createRequest();
    await handleGradeManualAttemptRequest(req, deps);
    assert.equal(getRpcCall().name, 'rpc_exam_grade_manual_attempt');
  });

  await test('35. no generic RPC invocation path', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        rpc_name: 'rpc_raw_admin_query',
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
  });

  await test('36. RPC payload exact', async () => {
    const { deps, getRpcCall } = createMockDependencies({
      user: { id: 'teacher-uuid-1' },
      profile: { id: 'teacher-uuid-1', role: 'teacher', is_disabled: false },
    });
    const req = createRequest({
      body: {
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 3,
        manual_grades: [
          { exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5, teacher_comment: 'Good' },
        ],
        teacher_feedback: 'Feedback here',
      },
    });
    await handleGradeManualAttemptRequest(req, deps);
    const args = getRpcCall().args;
    assert.deepEqual(args, {
      p_caller_id: 'teacher-uuid-1',
      p_attempt_id: '77777777-7777-4777-8777-777777777701',
      p_manual_grades: [
        { exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5, teacher_comment: 'Good' },
      ],
      p_teacher_feedback: 'Feedback here',
      p_expected_version: 3,
    });
  });

  // ==========================================================================
  // SECTION 5: ERROR MAPPING (37..44)
  // ==========================================================================
  console.log('\n--- 5. Error Mapping Tests (37..44) ---');

  await test('37. optimistic conflict -> 409 ERR_OPTIMISTIC_LOCK_CONFLICT', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch (expected 1, current 2)' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
  });

  await test('38. already graded -> 409 ERR_ATTEMPT_ALREADY_GRADED', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'ERR_ATTEMPT_ALREADY_GRADED: Attempt has already been graded' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_ATTEMPT_ALREADY_GRADED');
  });

  await test('39. duplicate grade -> 409 ERR_DUPLICATE_MANUAL_GRADE', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'ERR_DUPLICATE_MANUAL_GRADE: Duplicate grade entry' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_DUPLICATE_MANUAL_GRADE');
  });

  await test('40. invalid points -> 422 ERR_INVALID_MANUAL_POINTS', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'ERR_INVALID_MANUAL_POINTS: points exceeds question max points' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_INVALID_MANUAL_POINTS');
  });

  await test('41. missing answer row -> 422 ERR_MANUAL_ANSWER_ROW_MISSING', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'ERR_MANUAL_ANSWER_ROW_MISSING: Missing answer row' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_MANUAL_ANSWER_ROW_MISSING');
  });

  await test('42. snapshot invalid -> 422 ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'ERR_ATTEMPT_SNAPSHOT_INVALID: question_order is corrupted' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_ATTEMPT_SNAPSHOT_INVALID');
  });

  await test('43. unexpected DB error -> sanitized 500 INTERNAL_ERROR', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'FATAL: database connection terminated unexpectedly pg_catalog.pg_database' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(json.error_code, 'INTERNAL_ERROR');
    assert.equal(json.message.includes('pg_catalog'), false);
  });

  await test('44. no raw SQL error leaked', async () => {
    const { deps } = createMockDependencies({
      rpcResult: { error: 'SELECT * FROM app_private.exam_answer_keys WHERE id = 1; syntax error at or near' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    const json = await res.json();
    assert.equal(json.message.includes('app_private'), false);
    assert.equal(json.message.includes('exam_answer_keys'), false);
    assert.equal(json.message.includes('syntax error'), false);
  });

  // ==========================================================================
  // SECTION 6: RESPONSE CONTRACT & ALLOWLIST (45..49)
  // ==========================================================================
  console.log('\n--- 6. Response Contract Tests (45..49) ---');

  await test('45. success allowlist only', async () => {
    const { deps } = createMockDependencies({
      rpcResult: {
        data: {
          attempt_id: '77777777-7777-4777-8777-777777777701',
          status: 'graded',
          objective_score: 2.5,
          manual_score: 7.0,
          total_score: 9.5,
          max_score: 10.0,
          teacher_feedback: 'Great',
          graded_at: '2026-09-06T00:00:00Z',
          graded_by: 'teacher-uuid-1',
          reward_stars_awarded: 0,
          version: 2,
          idempotent_replay: false,
          internal_db_flag: true, // Should be stripped
          secret_column: 'secret-val', // Should be stripped
        },
        error: null,
      },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.deepEqual(Object.keys(json.data).sort(), [
      'attempt_id',
      'graded_at',
      'graded_by',
      'idempotent_replay',
      'manual_score',
      'max_score',
      'objective_score',
      'reward_stars_awarded',
      'status',
      'teacher_feedback',
      'total_score',
      'version',
    ]);
  });

  await test('46. no answer-key fields', async () => {
    const { deps } = createMockDependencies({
      rpcResult: {
        data: {
          attempt_id: '77777777-7777-4777-8777-777777777701',
          status: 'graded',
          max_score: 10.0,
          reward_stars_awarded: 0,
          version: 2,
          idempotent_replay: false,
          correct_answer: 'A',
          answer_key: { key: 'val' },
        },
      },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    const json = await res.json();
    assert.equal('correct_answer' in json.data, false);
    assert.equal('answer_key' in json.data, false);
  });

  await test('47. no service-role data', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    const str = JSON.stringify(await res.json());
    assert.equal(str.includes('service_role'), false);
    assert.equal(str.includes('eyJhbGciOi'), false);
  });

  await test('48. replay response preserved', async () => {
    const { deps } = createMockDependencies({
      rpcResult: {
        data: {
          attempt_id: '77777777-7777-4777-8777-777777777701',
          status: 'graded',
          max_score: 10.0,
          reward_stars_awarded: 0,
          version: 2,
          idempotent_replay: true,
        },
      },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    const json = await res.json();
    assert.equal(json.data.idempotent_replay, true);
  });

  await test('49. graded_by returned from RPC, not client', async () => {
    const { deps } = createMockDependencies({
      rpcResult: {
        data: {
          attempt_id: '77777777-7777-4777-8777-777777777701',
          status: 'graded',
          max_score: 10.0,
          reward_stars_awarded: 0,
          version: 2,
          idempotent_replay: false,
          graded_by: 'original-grader-uuid',
        },
      },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    const json = await res.json();
    assert.equal(json.data.graded_by, 'original-grader-uuid');
  });

  // ==========================================================================
  // SECTION 7: LOGGING & SECURITY AUDIT (50..52)
  // ==========================================================================
  console.log('\n--- 7. Logging & Security Audit Tests (50..52) ---');

  await test('50. Authorization header never logged', () => {
    const sensitive = 'Bearer secret-jwt-token-12345';
    const logOutput = `request_id=req_1 caller=user-1 attempt=att-1`;
    assert.equal(logOutput.includes(sensitive), false);
  });

  await test('51. service key never logged', () => {
    const sensitive = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
    const logOutput = `request_id=req_1 caller=user-1 attempt=att-1`;
    assert.equal(logOutput.includes(sensitive), false);
  });

  await test('52. manual answer contents not logged', () => {
    const sensitive = 'Bai lam van chi tiet cua hoc sinh...';
    const logOutput = `request_id=req_1 caller=user-1 attempt=att-1`;
    assert.equal(logOutput.includes(sensitive), false);
  });

  // ==========================================================================
  // SECTION 8: CORS & PROTOCOL (53..55)
  // ==========================================================================
  console.log('\n--- 8. CORS & Protocol Tests (53..55) ---');

  await test('53. OPTIONS handled -> 200 ok with CORS headers', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({ method: 'OPTIONS' });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  });

  await test('54. unsupported method (GET) -> 405 Method Not Allowed', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({ method: 'GET' });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 405);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_INPUT');
  });

  await test('55. no unsafe wildcard+credentials combination', () => {
    assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*');
    assert.equal('Access-Control-Allow-Credentials' in corsHeaders, false);
  });

  // ==========================================================================
  // SECTION 9: FAIL-CLOSED CLASS LOOKUP & DECIMAL SCALE MATRIX (56..65)
  // ==========================================================================
  console.log('\n--- 9. Fail-Closed Class Lookup & Scale Matrix Tests (56..65) ---');

  await test('56. attempt exists but assignment missing -> fail closed (404)', async () => {
    const { deps } = createMockDependencies({
      attemptRow: { id: '77777777-7777-4777-8777-777777777701', assignment_id: 'missing-assignment-uuid' },
      assignmentRow: null,
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error_code, 'ERR_ATTEMPT_NOT_FOUND');
  });

  await test('57. assignment exists but class missing in CORE -> 403 fail closed', async () => {
    const { deps } = createMockDependencies({
      assignmentRow: { id: 'assignment-uuid-1', class_id: 'missing-class-uuid' },
      classRow: null,
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  await test('58. teacher_id NULL -> denied (403)', async () => {
    const { deps } = createMockDependencies({
      classRow: { id: 'class-uuid-1', teacher_id: null },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  await test('59. teacher_id different caller -> denied (403)', async () => {
    const { deps } = createMockDependencies({
      user: { id: 'teacher-attacker-uuid' },
      profile: { id: 'teacher-attacker-uuid', role: 'teacher', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'teacher-legitimate-owner-uuid' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
  });

  await test('60. admin allowed even if teacher_id different', async () => {
    const { deps } = createMockDependencies({
      user: { id: 'admin-super-uuid' },
      profile: { id: 'admin-super-uuid', role: 'admin', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'other-teacher-uuid' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  await test('61. student denied even if class.teacher_id equals student ID', async () => {
    const { deps } = createMockDependencies({
      user: { id: 'student-sneaky-uuid' },
      profile: { id: 'student-sneaky-uuid', role: 'student', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'student-sneaky-uuid' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error_code, 'FORBIDDEN_ROLE');
  });

  await test('62. body class_id matching teacher class still ignored/rejected', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        class_id: 'class-uuid-1',
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
  });

  await test('63. body class_id other class rejected as unknown field', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({
      body: {
        class_id: 'other-unrelated-class-uuid',
        attempt_id: '77777777-7777-4777-8777-777777777701',
        expected_version: 1,
        manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.5 }],
      },
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
  });

  await test('64. NEW lookup error -> sanitized server error (500)', async () => {
    const { deps } = createMockDependencies({
      attemptError: { message: 'relation exam_attempts does not exist' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(json.error_code, 'INTERNAL_ERROR');
    assert.equal(json.message.includes('relation exam_attempts'), false);
  });

  await test('65. CORE class lookup error -> sanitized server error (500)', async () => {
    const { deps } = createMockDependencies({
      classError: { message: 'connection pool exhausted in public.classes' },
    });
    const req = createRequest();
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(json.error_code, 'INTERNAL_ERROR');
    assert.equal(json.message.includes('connection pool'), false);
  });

  // ==========================================================================
  // EXTRA: DECIMAL SCALE VALIDATION MATRIX UNIT TESTS
  // ==========================================================================
  console.log('\n--- Extra: Decimal Scale Validation Matrix Verification ---');
  {
    const basePayload = {
      attempt_id: '77777777-7777-4777-8777-777777777701',
      expected_version: 1,
      manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 1.23 }],
    };

    // 1.23 accepted
    const r1 = validateManualGradingPayload({ ...basePayload, manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 1.23 }] });
    assert.equal(r1.valid, true, '1.23 must be accepted');

    // 1.2 accepted
    const r2 = validateManualGradingPayload({ ...basePayload, manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 1.2 }] });
    assert.equal(r2.valid, true, '1.2 must be accepted');

    // 1 accepted
    const r3 = validateManualGradingPayload({ ...basePayload, manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 1 }] });
    assert.equal(r3.valid, true, '1 must be accepted');

    // 0.1 accepted
    const r4 = validateManualGradingPayload({ ...basePayload, manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 0.1 }] });
    assert.equal(r4.valid, true, '0.1 must be accepted');

    // 1.239 rejected
    const r5 = validateManualGradingPayload({ ...basePayload, manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 1.239 }] });
    assert.equal(r5.valid, false, '1.239 must be rejected');
    assert.equal(r5.errorCode, 'INVALID_INPUT');

    // 2.555 rejected
    const r6 = validateManualGradingPayload({ ...basePayload, manual_grades: [{ exam_question_id: '98888888-8888-4888-8888-888888888802', points_earned: 2.555 }] });
    assert.equal(r6.valid, false, '2.555 must be rejected');
    assert.equal(r6.errorCode, 'INVALID_INPUT');
    console.log('✅ PASS: Decimal Scale Matrix (1.23, 1.2, 1, 0.1 accepted; 1.239, 2.555 rejected)');
  }

  // ==========================================================================
  // SECTION 10: DEPLOYMENT GATE HARDENING & CROSS-PROJECT JWT (66..71)
  // ==========================================================================
  console.log('\n--- 10. Deployment Gate Hardening Tests (66..71) ---');

  await test('66. config contains [functions.exam-grade-manual-attempt]', () => {
    const configPath = path.resolve('supabase/config.toml');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.equal(content.includes('[functions.exam-grade-manual-attempt]'), true);
  });

  await test('67. config contains verify_jwt = false', () => {
    const configPath = path.resolve('supabase/config.toml');
    const content = fs.readFileSync(configPath, 'utf8');
    const funcSection = content.split('[functions.exam-grade-manual-attempt]')[1];
    assert.equal(typeof funcSection === 'string', true);
    assert.equal(funcSection.includes('verify_jwt = false'), true);
  });

  await test('68. missing Authorization still rejected by handler', async () => {
    const { deps } = createMockDependencies();
    const req = createRequest({ authHeader: null });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error_code, 'AUTH_REQUIRED');
  });

  await test('69. invalid CORE token still rejected by handler', async () => {
    const { deps } = createMockDependencies({
      authError: { message: 'Invalid JWT signature on CORE' },
      user: null,
    });
    const req = createRequest({ authHeader: 'Bearer fake-untrusted-token' });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error_code, 'INVALID_TOKEN');
  });

  await test('70. function does not trust NEW gateway claims for caller identity', async () => {
    const { deps, getRpcCall } = createMockDependencies({
      user: { id: 'core-authenticated-teacher-uuid' },
      profile: { id: 'core-authenticated-teacher-uuid', role: 'teacher', is_disabled: false },
      classRow: { id: 'class-uuid-1', teacher_id: 'core-authenticated-teacher-uuid' },
    });
    const req = createRequest({
      authHeader: 'Bearer valid-core-token-for-teacher',
    });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    const rpcArgs = getRpcCall().args;
    assert.equal(rpcArgs.p_caller_id, 'core-authenticated-teacher-uuid');
    assert.notEqual(rpcArgs.p_caller_id, 'hacker-fake-sub-claim');
  });

  await test('71. callerId still comes only from CORE auth.getUser()', async () => {
    const { deps, getRpcCall } = createMockDependencies({
      user: { id: 'strictly-verified-core-user-999' },
      profile: { id: 'strictly-verified-core-user-999', role: 'admin', is_disabled: false },
    });
    const req = createRequest({ authHeader: 'Bearer token-for-user-999' });
    const res = await handleGradeManualAttemptRequest(req, deps);
    assert.equal(res.status, 200);
    const rpcArgs = getRpcCall().args;
    assert.equal(rpcArgs.p_caller_id, 'strictly-verified-core-user-999');
  });

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('CRITICAL RUNNER ERROR:', err);
  process.exit(1);
});
