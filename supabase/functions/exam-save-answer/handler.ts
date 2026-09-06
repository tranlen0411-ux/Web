// supabase/functions/exam-save-answer/handler.ts
// Exam Builder Student Save Answer Handler V1 (Pure Dispatch Module - Zero Side Effects)

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  mapSaveAnswerSuccess,
  normalizeRpcError,
} from '../_shared/examErrors.ts';
import {
  AuthDependencies,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyStudentAuthAndDeriveContext,
} from '../_shared/examAuth.ts';
import { validateSaveAnswerPayload } from './validation.ts';

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  coreClient?: CoreQueryClient;
  examClient?: ExamQueryClient;
}

export async function handleSaveAnswerRequest(
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
    const examClient = deps?.examClient || authResult.examClient;

    if (!examClient) {
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

    // 6. Kiểm tra hợp lệ cấu trúc Payload (Strict Allowlist, Type, & Temporary Upload Gate)
    const valResult = validateSaveAnswerPayload(rawBody, { callerId });
    if (!valResult.valid || !valResult.sanitizedData) {
      let status = 400;
      if (valResult.errorCode === 'ATTEMPT_ACCESS_DENIED') {
        status = 403;
      } else if (valResult.errorCode === 'ERR_EXAM_UPLOAD_NOT_READY') {
        status = 422;
      }
      return createErrorResponse(
        status,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    // 7. Thực thi RPC Server-Side Autosave câu trả lời với Optimistic Locking
    const { data: rpcData, error: rpcErr } = await examClient.rpc(
      'rpc_exam_save_answer',
      {
        p_caller_id: callerId,
        p_attempt_id: sanitized.attempt_id,
        p_exam_question_id: sanitized.exam_question_id,
        p_student_answer_json: sanitized.student_answer_json,
        p_file_url: sanitized.file_url,
        p_expected_version: sanitized.expected_version,
      }
    );

    if (rpcErr) {
      const normalized = normalizeRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    // 8. Chiếu kết quả thành công qua Allowlist nghiêm ngặt
    const mapped = mapSaveAnswerSuccess(rpcData);
    if (!mapped.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Dữ liệu phản hồi từ máy chủ không đúng định dạng chuẩn.'
      );
    }

    return createSuccessResponse(mapped.data, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình lưu câu trả lời.'
    );
  }
}
