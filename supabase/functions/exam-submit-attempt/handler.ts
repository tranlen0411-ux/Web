// supabase/functions/exam-submit-attempt/handler.ts
// Exam Builder Student Submit Attempt Handler V1 (Pure Dispatch Module - Zero Side Effects)

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  mapSubmitAttemptSuccess,
  normalizeRpcError,
} from '../_shared/examErrors.ts';
import {
  AuthDependencies,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyStudentAuthAndDeriveContext,
} from '../_shared/examAuth.ts';
import { validateSubmitAttemptPayload } from './validation.ts';

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  examClient?: ExamQueryClient;
}

export async function handleSubmitAttemptRequest(
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

    // 6. Kiểm tra hợp lệ cấu trúc Payload (Strict Allowlist & Type Validation)
    const valResult = validateSubmitAttemptPayload(rawBody);
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    // 7. Thực thi RPC Server-Side Nộp bài thi và Tự động chấm trắc nghiệm
    const { data: rpcData, error: rpcErr } = await examClient.rpc(
      'rpc_exam_submit_attempt',
      {
        p_caller_id: callerId,
        p_attempt_id: sanitized.attempt_id,
        p_expected_version: sanitized.expected_version,
      }
    );

    if (rpcErr) {
      const normalized = normalizeRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    // 8. Chiếu kết quả thành công qua Allowlist nghiêm ngặt
    const mapped = mapSubmitAttemptSuccess(rpcData);
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
      'Đã xảy ra lỗi không xác định trong quá trình nộp bài thi.'
    );
  }
}
