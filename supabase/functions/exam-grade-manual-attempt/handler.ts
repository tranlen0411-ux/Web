// supabase/functions/exam-grade-manual-attempt/handler.ts
// Exam Builder Protected Manual Grading Handler V1 (Pure Dispatch Module - Zero Side Effects)

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  mapGradingSuccess,
  normalizeRpcError,
} from './errors.ts';
import {
  AuthDependencies,
  CoreQueryClient,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyAuthAndDeriveContext,
} from './authMiddleware.ts';
import { validateManualGradingPayload } from './validation.ts';

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  coreClient?: CoreQueryClient;
  examClient?: ExamQueryClient;
}

export async function handleGradeManualAttemptRequest(
  req: Request,
  deps?: HandlerDependencies
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 2. Enforce POST HTTP Method
  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'INVALID_INPUT',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.'
    );
  }

  try {
    // 3. Phân giải dependency mode (Production vs Injected Mock)
    let authDeps: AuthDependencies;
    if (deps?.authDeps && deps.authDeps.mode === 'injected') {
      authDeps = deps.authDeps;
    } else {
      authDeps = { mode: 'production' };
    }

    // 4. Xác thực JWT và trích xuất Trusted Context từ CORE
    const authResult = await verifyAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.')
      );
    }

    const { callerId, actorRole } = authResult.context;
    const coreClient = deps?.coreClient || authResult.coreClient;
    const examClient = deps?.examClient || authResult.examClient;

    if (!coreClient || !examClient) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Máy chủ chưa được cấu hình đầy đủ kết nối cơ sở dữ liệu.'
      );
    }

    // 5. Đọc và phân tích JSON Body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch (_) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.'
      );
    }

    // 6. Kiểm tra hợp lệ cấu trúc Payload (Strict Allowlist & Type Validation)
    const valResult = validateManualGradingPayload(rawBody);
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    // 7. Giải quyết chuỗi liên kết: attempt_id -> assignment_id -> class_id trên NEW Database (READ-ONLY)
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

    // 8. Phân quyền trên CORE Database (READ-ONLY)
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

    // 9. Thực thi RPC rpc_exam_grade_manual_attempt trên NEW Database bằng Service Role (Server-Side)
    // BẮT BUỘC: p_caller_id lấy trực tiếp từ callerId đã được xác thực từ CORE JWT, tuyệt đối không lấy từ body
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

    // 10. Chiếu kết quả thành công qua Allowlist an toàn (Zero Secret / Internal Leak)
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
