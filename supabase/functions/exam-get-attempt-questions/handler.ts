// supabase/functions/exam-get-attempt-questions/handler.ts
// Exam Builder Student Get Attempt Questions Handler V1 (Phase 3E-B0 Delivery Contract)
// Pure Dispatch Module - Zero Side Effects, Anti-Oracle Protection, Strict Strip-Mapping

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  mapGetAttemptQuestionsSuccess,
  normalizeGetAttemptQuestionsRpcError,
} from '../_shared/examErrors.ts';
import {
  AuthDependencies,
  CoreQueryClient,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyStudentAuthAndDeriveContext,
} from '../_shared/examAuth.ts';
import { validateGetAttemptQuestionsPayload } from './validation.ts';

export interface ExtendedExamQueryClient extends ExamQueryClient {
  rpc(
    name: 'rpc_exam_get_attempt_questions' | string,
    args: {
      p_caller_id: string;
      p_attempt_id: string;
    }
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  coreClient?: CoreQueryClient;
  examClient?: ExtendedExamQueryClient;
}

export async function handleGetAttemptQuestionsRequest(
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
      'METHOD_NOT_ALLOWED',
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

    // 4. Xác thực JWT và trích xuất Trusted Student Context từ CORE
    const authResult = await verifyStudentAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.')
      );
    }

    const { callerId } = authResult.context;
    const coreClient = deps?.coreClient || authResult.coreClient;
    const examClient = (deps?.examClient || authResult.examClient) as ExtendedExamQueryClient | undefined;

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
    const valResult = validateGetAttemptQuestionsPayload(rawBody, { callerId });
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    // 7. BFF Anti-Oracle Precheck: Xác minh lượt thi thuộc về học sinh (READ-ONLY)
    const { data: attemptRow, error: attemptErr } = await examClient
      .from('exam_attempts')
      .select('id, assignment_id, student_id')
      .eq('id', sanitized.attempt_id)
      .eq('student_id', callerId)
      .maybeSingle();

    if (attemptErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin lượt làm bài.');
    }

    if (!attemptRow) {
      // Unified 404: Không phân biệt attempt không tồn tại hay thuộc về học sinh khác
      return createErrorResponse(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài thi.');
    }

    // 8. Giải quyết assignment -> class_id trên NEW Database (READ-ONLY)
    const { data: assignmentRow, error: assignErr } = await examClient
      .from('exam_assignments')
      .select('id, class_id')
      .eq('id', attemptRow.assignment_id)
      .maybeSingle();

    if (assignErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin bài giao.');
    }

    if (!assignmentRow) {
      return createErrorResponse(404, 'ERR_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài thi được giao.');
    }

    const resolvedClassId = assignmentRow.class_id;

    // 9. Xác thực tư cách thành viên lớp học trên CORE Database (READ-ONLY)
    // CROSS_PROJECT_MEMBERSHIP_CHECK_ATOMIC=NO
    const { data: memberRow, error: memberErr } = await coreClient
      .from('class_members')
      .select('class_id, student_id')
      .eq('class_id', resolvedClassId)
      .eq('student_id', callerId)
      .maybeSingle();

    if (memberErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra danh sách thành viên lớp học.');
    }

    if (!memberRow) {
      return createErrorResponse(
        403,
        'CLASS_ACCESS_DENIED',
        'Bạn không thuộc danh sách lớp học được giao bài thi này.'
      );
    }

    // 10. Thực thi RPC Server-Side Tải câu hỏi an toàn
    const { data: rpcData, error: rpcErr } = await examClient.rpc(
      'rpc_exam_get_attempt_questions',
      {
        p_caller_id: callerId,
        p_attempt_id: sanitized.attempt_id,
      }
    );

    if (rpcErr) {
      const normalized = normalizeGetAttemptQuestionsRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    // 11. Chiếu kết quả thành công qua Allowlist nghiêm ngặt (Strip / Reject internal fields)
    const mapped = mapGetAttemptQuestionsSuccess(rpcData);
    if (!mapped.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Dữ liệu câu hỏi từ máy chủ không đúng định dạng chuẩn.'
      );
    }

    return createSuccessResponse(mapped.data, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình tải câu hỏi bài thi.'
    );
  }
}
