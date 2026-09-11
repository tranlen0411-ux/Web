// supabase/functions/exam-management-api/handler.ts
// Exam Builder Management BFF Router & Dispatch Handler

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  normalizeRpcError,
} from './errors.ts';
import {
  AuthDependencies,
  CoreQueryClient,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyManagementAuthAndDeriveContext,
} from './authMiddleware.ts';
import {
  validateCreateTestPayload,
  validateSaveDraftPayload,
  validatePublishPayload,
  validateCreateAssignmentPayload,
  isValidUUID,
} from './validation.ts';

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  coreClient?: CoreQueryClient;
  examClient?: ExamQueryClient;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function handleExamManagementRequest(
  req: Request,
  deps?: HandlerDependencies
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Xác thực và trích xuất Trusted Context từ CORE JWT
    let authDeps: AuthDependencies;
    if (deps?.authDeps && deps.authDeps.mode === 'injected') {
      authDeps = deps.authDeps;
    } else {
      authDeps = { mode: 'production' };
    }

    const authResult = await verifyManagementAuthAndDeriveContext(req, authDeps);
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

    // 3. Phân tích URL và Action
    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    // Nhận diện action từ endpoint URL path (ví dụ /list-tests, /create-test, ...) hoặc query param ?action=...
    const action = pathSegments[pathSegments.length - 1] || url.searchParams.get('action') || '';

    // =========================================================================
    // ENDPOINT 1: GET /list-tests
    // =========================================================================
    if (req.method === 'GET' && (action === 'list-tests' || action === 'tests' || action === 'exam-management-api')) {
      let query = examClient
        .from('exam_tests')
        .select(`
          id,
          author_id,
          title,
          subject,
          grade_level,
          status,
          current_version_id,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false });

      // Phân quyền Teacher: chỉ lấy đề thi do chính mình tạo
      if (actorRole === 'teacher') {
        query = query.eq('author_id', callerId);
      }

      const { data: testsData, error: testsErr } = await query;
      if (testsErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tải danh sách đề thi.');
      }

      const tests = testsData || [];
      if (tests.length === 0) {
        return createSuccessResponse({ tests: [] });
      }

      // Lấy danh sách version_id (current_version_id hoặc version mới nhất)
      const testIds = tests.map((t: any) => t.id);
      const { data: versionsData } = await examClient
        .from('exam_versions')
        .select(`
          id,
          exam_id,
          version_number,
          title,
          description,
          subject,
          grade_level,
          duration_minutes,
          starts_at,
          last_start_at,
          due_date,
          max_attempts,
          reward_stars,
          total_points,
          status,
          published_at,
          created_at
        `)
        .in('exam_id', testIds);

      const versionsByExamId: Record<string, any[]> = {};
      (versionsData || []).forEach((v: any) => {
        if (!versionsByExamId[v.exam_id]) versionsByExamId[v.exam_id] = [];
        versionsByExamId[v.exam_id].push(v);
      });

      // Lấy thông tin tác giả từ CORE profiles nếu là Admin
      const authorIds = Array.from(new Set(tests.map((t: any) => t.author_id))).filter(Boolean);
      let authorsMap: Record<string, { id: string; full_name: string }> = {};
      if (authorIds.length > 0) {
        try {
          const { data: authorProfiles } = await coreClient
            .from('profiles')
            .select('id, full_name')
            .in?.('id', authorIds as string[]) || { data: null };

          if (authorProfiles) {
            authorProfiles.forEach((p: any) => {
              authorsMap[p.id] = p;
            });
          }
        } catch (_) {
          // Non-fatal
        }
      }

      // Hợp nhất dữ liệu trả về an toàn
      const enrichedTests = tests.map((t: any) => {
        const examVersions = versionsByExamId[t.id] || [];
        // Ưu tiên current_version, nếu chưa có thì lấy version nháp mới nhất
        const activeVersion =
          examVersions.find((v: any) => v.id === t.current_version_id) ||
          examVersions.sort((a: any, b: any) => b.version_number - a.version_number)[0] ||
          null;

        return {
          id: t.id,
          author_id: t.author_id,
          author_name: authorsMap[t.author_id]?.full_name || 'Giáo viên',
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
                max_attempts: activeVersion.max_attempts,
                reward_stars: activeVersion.reward_stars,
                total_points: activeVersion.total_points,
                status: activeVersion.status,
                published_at: activeVersion.published_at,
              }
            : null,
        };
      });

      return createSuccessResponse({ tests: enrichedTests });
    }

    // =========================================================================
    // ENDPOINT 2: GET /get-test-detail
    // =========================================================================
    if (req.method === 'GET' && action === 'get-test-detail') {
      const examId = url.searchParams.get('exam_id');
      const versionId = url.searchParams.get('version_id');

      if (!examId && !versionId) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Yêu cầu tham số exam_id hoặc version_id.');
      }

      let testRow: any = null;
      let versionRow: any = null;

      if (versionId) {
        const { data: vData, error: vErr } = await examClient
          .from('exam_versions')
          .select('*')
          .eq('id', versionId)
          .maybeSingle();

        if (vErr || !vData) {
          return createErrorResponse(404, 'NOT_FOUND', 'Không tìm thấy phiên bản đề thi.');
        }
        versionRow = vData;

        const { data: tData, error: tErr } = await examClient
          .from('exam_tests')
          .select('*')
          .eq('id', versionRow.exam_id)
          .maybeSingle();

        if (tErr || !tData) {
          return createErrorResponse(404, 'NOT_FOUND', 'Không tìm thấy đề thi.');
        }
        testRow = tData;
      } else if (examId) {
        const { data: tData, error: tErr } = await examClient
          .from('exam_tests')
          .select('*')
          .eq('id', examId)
          .maybeSingle();

        if (tErr || !tData) {
          return createErrorResponse(404, 'NOT_FOUND', 'Không tìm thấy đề thi.');
        }
        testRow = tData;

        // Tìm version nháp mới nhất hoặc current_version
        const { data: vList } = await examClient
          .from('exam_versions')
          .select('*')
          .eq('exam_id', examId)
          .order('version_number', { ascending: false });

        versionRow =
          (vList || []).find((v: any) => v.id === testRow.current_version_id) ||
          (vList || [])[0] ||
          null;
      }

      // Phân quyền: Teacher chỉ được xem đề thi do mình tạo
      if (actorRole === 'teacher' && testRow.author_id !== callerId) {
        return createErrorResponse(403, 'ERR_UNAUTHORIZED', 'Bạn không có quyền xem đề thi của giáo viên khác.');
      }

      let questions: any[] = [];
      if (versionRow) {
        const { data: qData } = await examClient
          .from('exam_questions')
          .select(`
            id,
            exam_version_id,
            question_number,
            question_type,
            prompt,
            options_json,
            points,
            source_question_bank_item_id,
            source_question_bank_version_id,
            created_at
          `)
          .eq('exam_version_id', versionRow.id)
          .order('question_number', { ascending: true });

        questions = qData || [];

        // Lấy đáp án từ app_private.exam_answer_keys để hiển thị cho Tác giả / Admin soạn thảo
        if (questions.length > 0) {
          const qIds = questions.map((q: any) => q.id);
          try {
            const { data: keysData } = await examClient
              .from('exam_answer_keys')
              .select('*')
              .in('question_id', qIds);

            const keysMap = new Map((keysData || []).map((k: any) => [k.question_id, k]));
            questions = questions.map((q: any) => ({
              ...q,
              answer_key: keysMap.get(q.id) || null,
            }));
          } catch (_) {
            // Non-fatal
          }
        }
      }

      return createSuccessResponse({
        test: testRow,
        version: versionRow,
        questions,
      });
    }

    // =========================================================================
    // ENDPOINT 3: POST /create-test
    // =========================================================================
    if (req.method === 'POST' && action === 'create-test') {
      let rawBody: unknown;
      try {
        rawBody = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.');
      }

      const valResult = validateCreateTestPayload(rawBody);
      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Dữ liệu không hợp lệ.');
      }

      const payload = valResult.data;
      const examId = generateUuid();
      const versionId = generateUuid();

      const rpcRes = await examClient.rpc('rpc_exam_create_test', {
        p_caller_id: callerId,
        p_exam_id: examId,
        p_version_id: versionId,
        p_title: payload.title,
        p_subject: payload.subject,
        p_grade_level: payload.grade_level,
        p_description: payload.description,
        p_is_admin: actorRole === 'admin',
      });

      if (rpcRes.error) {
        const norm = normalizeRpcError(rpcRes.error);
        return createErrorResponse(norm.status, norm.errorCode, norm.message);
      }

      return createSuccessResponse(rpcRes.data, 201);
    }

    // =========================================================================
    // ENDPOINT 4: POST /save-draft
    // =========================================================================
    if (req.method === 'POST' && action === 'save-draft') {
      let rawBody: unknown;
      try {
        rawBody = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.');
      }

      const valResult = validateSaveDraftPayload(rawBody);
      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Dữ liệu không hợp lệ.');
      }

      const payload = valResult.data;

      const rpcRes = await examClient.rpc('rpc_exam_save_draft_version', {
        p_caller_id: callerId,
        p_version_id: payload.version_id,
        p_title: payload.title,
        p_subject: payload.subject,
        p_grade_level: payload.grade_level,
        p_description: payload.description,
        p_duration_minutes: payload.duration_minutes,
        p_starts_at: payload.starts_at,
        p_due_date: payload.due_date,
        p_max_attempts: payload.max_attempts,
        p_reward_stars: payload.reward_stars,
        p_shuffle_questions: payload.shuffle_questions,
        p_shuffle_options: payload.shuffle_options,
        p_tab_switch_policy: payload.tab_switch_policy,
        p_show_score_after_submit: payload.show_score_after_submit,
        p_show_correct_answers: payload.show_correct_answers,
        p_questions: payload.questions,
        p_is_admin: actorRole === 'admin',
        p_last_start_at: payload.last_start_at,
      });

      if (rpcRes.error) {
        const norm = normalizeRpcError(rpcRes.error);
        return createErrorResponse(norm.status, norm.errorCode, norm.message);
      }

      return createSuccessResponse(rpcRes.data, 200);
    }

    // =========================================================================
    // ENDPOINT 5: POST /publish
    // =========================================================================
    if (req.method === 'POST' && action === 'publish') {
      let rawBody: unknown;
      try {
        rawBody = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.');
      }

      const valResult = validatePublishPayload(rawBody);
      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Dữ liệu không hợp lệ.');
      }

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

    // =========================================================================
    // ENDPOINT 6: POST /create-assignment (CRITICAL P0 SECURITY)
    // =========================================================================
    if (req.method === 'POST' && action === 'create-assignment') {
      let rawBody: unknown;
      try {
        rawBody = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.');
      }

      const valResult = validateCreateAssignmentPayload(rawBody);
      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Dữ liệu không hợp lệ.');
      }

      const payload = valResult.data;

      // 1. Kiểm tra tồn tại và quyền sở hữu lớp học trên CORE DB
      const { data: classRow, error: classErr } = await coreClient
        .from('classes')
        .select('id, teacher_id, name, grade_level')
        .eq('id', payload.class_id)
        .maybeSingle();

      if (classErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi kiểm tra thông tin lớp học.');
      }

      if (!classRow) {
        return createErrorResponse(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học được chọn.');
      }

      // CRITICAL P0 SECURITY GUARD: Giáo viên chỉ được giao bài cho lớp mình trực tiếp quản lý
      if (actorRole === 'teacher' && classRow.teacher_id !== callerId) {
        return createErrorResponse(
          403,
          'CLASS_ACCESS_DENIED',
          'Bạn không có quyền giao bài thi cho lớp học này (Lớp do giáo viên khác quản lý).'
        );
      }

      // 2. Thực thi RPC rpc_exam_create_assignment trên NEW DB bằng Service Role
      const assignmentId = payload.assignment_id || generateUuid();

      const rpcRes = await examClient.rpc('rpc_exam_create_assignment', {
        p_caller_id: callerId,
        p_assignment_id: assignmentId,
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

    // Nếu không khớp action nào
    return createErrorResponse(404, 'ENDPOINT_NOT_FOUND', `Không tìm thấy endpoint: ${action}`);
  } catch (err: any) {
    return createErrorResponse(500, 'INTERNAL_ERROR', err?.message || 'Đã xảy ra lỗi không xác định.');
  }
}
