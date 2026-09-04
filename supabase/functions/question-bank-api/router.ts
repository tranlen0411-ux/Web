// supabase/functions/question-bank-api/router.ts
// Question Bank User-Facing BFF REST Router Dispatcher V1 (Pure Dispatch Module - Zero Side Effects)

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  mapCreateQuestionSuccess,
  mapCreateVersionSuccess,
  mapGetStudentQuestionSuccess,
  mapGetAuthoringDetailSuccess,
  mapListQuestionsSuccess,
  mapForkQuestionSuccess,
  mapUpdateMetadataSuccess,
  mapArchiveQuestionSuccess,
  mapRestoreQuestionSuccess,
  mapPublishQuestionSuccess,
  mapListVersionsSuccess,
  normalizeRpcError,
} from './errors.ts';
import {
  AuthDependencies,
  InjectedAuthDependencies,
  RpcClient,
  UserFacingQuestionBankRpc,
  verifyAuthAndDeriveContext,
} from './authMiddleware.ts';
import {
  isPlainObject,
  isValidUUID,
  validateCreateQuestionPayload,
  validateCreateVersionPayload,
  validateForkQuestionPayload,
  validateUpdateMetadataPayload,
  validateStudentQueryParams,
  validateAuthoringQueryParams,
  validateListFilters,
} from './validation.ts';

export type { UserFacingQuestionBankRpc, InjectedAuthDependencies };

export type RouterDependencies =
  | { mode?: 'production' }
  | {
      mode: 'injected';
      authDeps: InjectedAuthDependencies;
      rpcClient: RpcClient;
    };

export async function handleQuestionBankRequest(
  req: Request,
  deps?: RouterDependencies
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, ''); // Bỏ trailing slash
    const method = req.method.toUpperCase();

    // Phân giải dependency mode: All-or-Nothing
    let authDeps: AuthDependencies;
    let injectedRpcClient: RpcClient | undefined;

    if (deps?.mode === 'injected') {
      if (
        !deps.authDeps ||
        deps.authDeps.mode !== 'injected' ||
        !deps.authDeps.callerAuthClient ||
        !deps.authDeps.profileQueryClient ||
        !deps.rpcClient
      ) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Cấu hình router mock dependencies không đầy đủ.'
        );
      }
      authDeps = deps.authDeps;
      injectedRpcClient = deps.rpcClient;
    } else {
      authDeps = { mode: 'production' };
    }

    // 2. Xác thực và trích xuất Trusted Context
    const authResult = await verifyAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'UNAUTHORIZED', 'Xác thực không thành công.')
      );
    }

    const { context } = authResult;
    const { callerId, actorRole } = context;

    // Chọn RPC client phù hợp
    const rpcClient: RpcClient | undefined =
      deps?.mode === 'injected' ? injectedRpcClient : authResult.adminClient;

    if (!rpcClient) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Cấu hình RPC client không hợp lệ.'
      );
    }

    // ------------------------------------------------------------------------
    // ROUTE 1: POST /qb/questions -> rpc_qb_create_question
    // ------------------------------------------------------------------------
    if (method === 'POST' && pathname.endsWith('/qb/questions')) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên hoặc quản trị viên mới có quyền tạo câu hỏi.'
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'JSON body không hợp lệ.');
      }

      const validation = validateCreateQuestionPayload(body);
      if (!validation.valid || !validation.sanitizedData) {
        return createErrorResponse(
          validation.errorCode === 'SCHOOL_CONTEXT_NOT_AVAILABLE' ? 409 : 400,
          validation.errorCode || 'INVALID_INPUT',
          validation.errorMessage || 'Dữ liệu câu hỏi không hợp lệ.'
        );
      }

      // Gọi RPC 1
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_create_question',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_payload: validation.sanitizedData,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapCreateQuestionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 201);
    }

    // ------------------------------------------------------------------------
    // ROUTE 2: POST /qb/questions/:id/versions -> rpc_qb_create_version
    // ------------------------------------------------------------------------
    const versionMatch = pathname.match(/\/qb\/questions\/([^\/]+)\/versions$/);
    if (method === 'POST' && versionMatch) {
      const itemId = versionMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên hoặc quản trị viên mới có quyền tạo phiên bản.'
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'JSON body không hợp lệ.');
      }

      const validation = validateCreateVersionPayload(body);
      if (!validation.valid || !validation.sanitizedData) {
        return createErrorResponse(
          400,
          validation.errorCode || 'INVALID_INPUT',
          validation.errorMessage || 'Dữ liệu phiên bản không hợp lệ.'
        );
      }

      // Gọi RPC 2
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_create_version',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
          p_payload: validation.sanitizedData,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapCreateVersionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 201);
    }

    // ------------------------------------------------------------------------
    // ROUTE 2B: GET /qb/questions/:id/versions -> rpc_qb_list_versions
    // ------------------------------------------------------------------------
    if (method === 'GET' && versionMatch) {
      const itemId = versionMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền xem lịch sử phiên bản.'
        );
      }

      // Gọi RPC rpc_qb_list_versions
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_list_versions',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapListVersionsSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 3: GET /qb/student/questions/:id -> rpc_qb_get_student_question
    // ------------------------------------------------------------------------
    const studentMatch = pathname.match(/\/qb\/student\/questions\/([^\/]+)$/);
    if (method === 'GET' && studentMatch) {
      const itemId = studentMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      const queryValidation = validateStudentQueryParams(url.searchParams);
      if (!queryValidation.valid || !queryValidation.sanitizedData) {
        return createErrorResponse(
          400,
          queryValidation.errorCode || 'INVALID_REQUEST_FIELD',
          queryValidation.errorMessage || 'Tham số query không hợp lệ.'
        );
      }

      // Gọi RPC 3
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_get_student_question',
        {
          p_caller_id: callerId,
          p_item_id: itemId,
          p_version_id: queryValidation.sanitizedData.versionId || null,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapGetStudentQuestionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 4: GET /qb/authoring/questions/:id -> rpc_qb_get_authoring_detail
    // ------------------------------------------------------------------------
    const authoringMatch = pathname.match(/\/qb\/authoring\/questions\/([^\/]+)$/);
    if (method === 'GET' && authoringMatch) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Học sinh không có quyền xem chi tiết soạn thảo câu hỏi.'
        );
      }

      const itemId = authoringMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      const queryValidation = validateAuthoringQueryParams(url.searchParams);
      if (!queryValidation.valid || !queryValidation.sanitizedData) {
        return createErrorResponse(
          400,
          queryValidation.errorCode || 'INVALID_REQUEST_FIELD',
          queryValidation.errorMessage || 'Tham số query không hợp lệ.'
        );
      }

      // Gọi RPC 4
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_get_authoring_detail',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
          p_version_id: queryValidation.sanitizedData.versionId || null,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapGetAuthoringDetailSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 5: GET /qb/questions -> rpc_qb_list_questions
    // ------------------------------------------------------------------------
    if (method === 'GET' && pathname.endsWith('/qb/questions')) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền duyệt danh sách ngân hàng câu hỏi.'
        );
      }

      const filterValidation = validateListFilters(url.searchParams);
      if (!filterValidation.valid || !filterValidation.sanitizedData) {
        return createErrorResponse(
          filterValidation.errorCode === 'SCHOOL_CONTEXT_NOT_AVAILABLE' ? 409 : 400,
          filterValidation.errorCode || 'INVALID_INPUT',
          filterValidation.errorMessage || 'Bộ lọc không hợp lệ.'
        );
      }

      // Gọi RPC 5
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_list_questions',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_filters: filterValidation.sanitizedData,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapListQuestionsSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 6: POST /qb/versions/:versionId/fork -> rpc_qb_fork_question
    // ------------------------------------------------------------------------
    const forkMatch = pathname.match(/\/qb\/versions\/([^\/]+)\/fork$/);
    if (method === 'POST' && forkMatch) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền sao chép câu hỏi.'
        );
      }

      const sourceVersionId = forkMatch[1];
      if (!isValidUUID(sourceVersionId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID phiên bản nguồn (versionId) không đúng định dạng UUID.'
        );
      }

      let body: unknown = {};
      try {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = JSON.parse(text);
        }
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'JSON body không hợp lệ.');
      }

      const validation = validateForkQuestionPayload(body);
      if (!validation.valid || !validation.sanitizedData) {
        return createErrorResponse(
          validation.errorCode === 'SCHOOL_CONTEXT_NOT_AVAILABLE' ? 409 : 400,
          validation.errorCode || 'INVALID_INPUT',
          validation.errorMessage || 'Dữ liệu fork không hợp lệ.'
        );
      }

      // Gọi RPC 6 (Zero direct table read)
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_fork_question',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_source_version_id: sourceVersionId,
          p_overrides: validation.sanitizedData,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapForkQuestionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 201);
    }

    // ------------------------------------------------------------------------
    // ROUTE 7: PATCH /qb/questions/:id/metadata -> rpc_qb_update_item_metadata
    // ------------------------------------------------------------------------
    const metaMatch = pathname.match(/\/qb\/questions\/([^\/]+)\/metadata$/);
    if (method === 'PATCH' && metaMatch) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền cập nhật metadata.'
        );
      }

      const itemId = metaMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'JSON body không hợp lệ.');
      }

      const validation = validateUpdateMetadataPayload(body);
      if (!validation.valid || !validation.sanitizedData) {
        return createErrorResponse(
          validation.errorCode === 'SCHOOL_CONTEXT_NOT_AVAILABLE' ? 409 : 400,
          validation.errorCode || 'INVALID_INPUT',
          validation.errorMessage || 'Dữ liệu metadata không hợp lệ.'
        );
      }

      // Gọi RPC 7
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_update_item_metadata',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
          p_payload: validation.sanitizedData,
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapUpdateMetadataSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 8: PATCH /qb/questions/:id/archive -> rpc_qb_update_item_metadata (status: 'archived')
    // ------------------------------------------------------------------------
    const archiveMatch = pathname.match(/\/qb\/questions\/([^\/]+)\/archive$/);
    if (method === 'PATCH' && archiveMatch) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền ẩn câu hỏi.'
        );
      }

      const itemId = archiveMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      // Gọi RPC với payload { status: 'archived' }
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_update_item_metadata',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
          p_payload: { status: 'archived' },
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapArchiveQuestionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 9: PATCH /qb/questions/:id/restore -> rpc_qb_update_item_metadata (status: 'draft')
    // ------------------------------------------------------------------------
    const restoreMatch = pathname.match(/\/qb\/questions\/([^\/]+)\/restore$/);
    if (method === 'PATCH' && restoreMatch) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền khôi phục câu hỏi.'
        );
      }

      const itemId = restoreMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      // Gọi RPC với payload { status: 'draft' }
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_update_item_metadata',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
          p_payload: { status: 'draft' },
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapRestoreQuestionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // ------------------------------------------------------------------------
    // ROUTE 10: PATCH /qb/questions/:id/publish -> rpc_qb_update_item_metadata (status: 'published')
    // ------------------------------------------------------------------------
    const publishMatch = pathname.match(/\/qb\/questions\/([^\/]+)\/publish$/);
    if (method === 'PATCH' && publishMatch) {
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Chỉ giáo viên và quản trị viên mới có quyền xuất bản câu hỏi.'
        );
      }

      const itemId = publishMatch[1];
      if (!isValidUUID(itemId)) {
        return createErrorResponse(
          400,
          'INVALID_INPUT',
          'ID câu hỏi không đúng định dạng UUID.'
        );
      }

      // Gọi RPC với payload { status: 'published' }
      const { data: rpcRes, error: rpcError } = await rpcClient.rpc(
        'rpc_qb_update_item_metadata',
        {
          p_caller_id: callerId,
          p_actor_role: actorRole,
          p_item_id: itemId,
          p_payload: { status: 'published' },
        }
      );

      const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
      if (rpcError || !rpcPayload || rpcPayload.success !== true) {
        const err = normalizeRpcError(rpcError, rpcPayload);
        return createErrorResponse(err.status, err.errorCode, err.message);
      }

      const mapped = mapPublishQuestionSuccess(rpcPayload);
      if (!mapped.ok) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Phản hồi máy chủ không hợp lệ.'
        );
      }

      return createSuccessResponse(mapped.data, 200);
    }

    // 404 Route Not Found
    return createErrorResponse(404, 'NOT_FOUND', 'Đường dẫn API không tồn tại.');
  } catch (_) {
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Đã xảy ra lỗi máy chủ nội bộ.');
  }
}
