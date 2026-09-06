// supabase/functions/exam-record-integrity-event/handler.ts
// Exam Builder Student Integrity Event Handler V1 (Pure Dispatch Module - Zero Side Effects)

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  mapRecordIntegrityEventSuccess,
  normalizeIntegrityRpcError,
} from '../_shared/examErrors.ts';
import {
  AuthDependencies,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyStudentAuthAndDeriveContext,
} from '../_shared/examAuth.ts';
import { validateIntegrityEventPayload } from './validation.ts';

const MAX_PAYLOAD_BYTES = 10 * 1024; // 10KB maximum payload size
const EXTRA_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
};

export interface ExtendedExamQueryClient extends ExamQueryClient {
  rpc(
    name: 'rpc_exam_record_integrity_event' | string,
    args: {
      p_caller_id: string;
      p_attempt_id: string;
      p_source: string;
      p_client_timestamp: string | null;
    }
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  examClient?: ExtendedExamQueryClient;
}

export async function handleRecordIntegrityEventRequest(
  req: Request,
  deps?: HandlerDependencies
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store',
        ...EXTRA_SECURITY_HEADERS,
      },
    });
  }

  // 2. Enforce POST HTTP Method
  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.',
      { Allow: 'POST', ...EXTRA_SECURITY_HEADERS }
    );
  }

  // 3. Enforce application/json Content-Type (Media Type Check)
  const contentTypeHeader = req.headers.get('content-type') || '';
  const mediaType = contentTypeHeader.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return createErrorResponse(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Định dạng Content-Type không được hỗ trợ. Bắt buộc sử dụng application/json.',
      EXTRA_SECURITY_HEADERS
    );
  }

  try {
    // 4. Phân giải dependency mode (Production vs Injected Mock)
    let authDeps: AuthDependencies;
    if (deps?.authDeps && deps.authDeps.mode === 'injected') {
      authDeps = deps.authDeps;
    } else {
      authDeps = { mode: 'production' };
    }

    // 5. Xác thực JWT và trích xuất Trusted Student Context từ CORE
    const authResult = await verifyStudentAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.', EXTRA_SECURITY_HEADERS)
      );
    }

    const { callerId } = authResult.context;
    const examClient = (deps?.examClient || authResult.examClient) as ExtendedExamQueryClient | undefined;

    if (!examClient) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Máy chủ chưa được cấu hình đầy đủ kết nối cơ sở dữ liệu.',
        EXTRA_SECURITY_HEADERS
      );
    }

    // 6. Đọc Text Body và kiểm tra giới hạn kích thước Payload (< 10KB)
    let rawText: string;
    try {
      rawText = await req.text();
    } catch (_) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Không thể đọc nội dung yêu cầu.',
        EXTRA_SECURITY_HEADERS
      );
    }

    if (new TextEncoder().encode(rawText).length > MAX_PAYLOAD_BYTES) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Dung lượng yêu cầu vượt quá giới hạn cho phép (10KB).',
        EXTRA_SECURITY_HEADERS
      );
    }

    // 7. Phân tích JSON Body
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(rawText);
    } catch (_) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.',
        EXTRA_SECURITY_HEADERS
      );
    }

    // 8. Kiểm tra hợp lệ cấu trúc Payload (Strict Allowlist, Type, & Enum)
    const valResult = validateIntegrityEventPayload(rawBody, { callerId });
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.',
        EXTRA_SECURITY_HEADERS
      );
    }

    const { attempt_id, source, client_timestamp } = valResult.sanitizedData;

    // 9. Thực thi RPC duy nhất đúng 1 lần (Single-call execution — No blind internal retry)
    const { data: rpcData, error: rpcError } = await examClient.rpc(
      'rpc_exam_record_integrity_event',
      {
        p_caller_id: callerId,
        p_attempt_id: attempt_id,
        p_source: source,
        p_client_timestamp: client_timestamp,
      }
    );

    // 10. Xử lý lỗi từ RPC với Scoped Anti-Oracle Error Normalizer
    if (rpcError) {
      const { status, errorCode, message } = normalizeIntegrityRpcError(rpcError);
      return createErrorResponse(status, errorCode, message, EXTRA_SECURITY_HEADERS);
    }

    // 11. Chiếu trường phản hồi an toàn (Safe Response Projection Allowlist)
    const projection = mapRecordIntegrityEventSuccess(rpcData);
    if (!projection.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Dữ liệu phản hồi từ máy chủ cơ sở dữ liệu không hợp lệ.',
        EXTRA_SECURITY_HEADERS
      );
    }

    return createSuccessResponse(projection.data, 200, EXTRA_SECURITY_HEADERS);
  } catch (_err) {
    // 12. Fail-closed fallback (Zero DB/SQL Details Leaked)
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không mong muốn trong quá trình xử lý sự kiện thi.',
      EXTRA_SECURITY_HEADERS
    );
  }
}

