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
  validateListExamAttemptsParams,
  validateGetAttemptDetailParams,
  validateImportQuestionBankPayload,
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
      let targetVersionId = url.searchParams.get('version_id');
      const examId = url.searchParams.get('exam_id');

      if (!targetVersionId && !examId) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Yêu cầu tham số exam_id hoặc version_id.');
      }

      if (!targetVersionId && examId) {
        // Tìm version nháp mới nhất của đề thi
        const { data: vList, error: vListErr } = await examClient
          .from('exam_versions')
          .select('id, version_number, status')
          .eq('exam_id', examId)
          .order('version_number', { ascending: false });

        if (vListErr) {
          return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tra cứu phiên bản đề thi.');
        }

        const draftV = (vList || []).find((v: any) => v.status === 'draft') || (vList || [])[0];
        if (!draftV) {
          return createErrorResponse(404, 'NOT_FOUND', 'Không tìm thấy phiên bản đề thi.');
        }
        targetVersionId = draftV.id;
      }

      if (!isValidUUID(targetVersionId)) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Mã version_id không hợp lệ.');
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

      // Pre-publish choice schema check (Defense-in-depth)
      const { data: questions, error: qErr } = await examClient
        .from('exam_questions')
        .select('id, question_number, question_type, options_json')
        .eq('exam_version_id', valResult.data.version_id);

      if (qErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra danh sách câu hỏi trước khi xuất bản.');
      }

      if (Array.isArray(questions)) {
        for (const q of questions) {
          if (['single_choice', 'multiple_choice'].includes(q.question_type)) {
            if (!Array.isArray(q.options_json) || q.options_json.length < 2) {
              return createErrorResponse(
                422,
                'ERR_INVALID_OPTION_SCHEMA',
                `Câu hỏi trắc nghiệm số ${q.question_number} không có đủ tối thiểu 2 phương án hợp lệ.`
              );
            }
            const seenKeys = new Set<string>();
            for (let idx = 0; idx < q.options_json.length; idx++) {
              const opt = q.options_json[idx];
              if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
                return createErrorResponse(
                  422,
                  'ERR_INVALID_OPTION_SCHEMA',
                  `Câu hỏi trắc nghiệm số ${q.question_number} chứa phương án không phải là đối tượng {key, text}.`
                );
              }
              const optKey = typeof opt.key === 'string' ? opt.key.trim() : '';
              if (!optKey) {
                return createErrorResponse(
                  422,
                  'ERR_INVALID_OPTION_SCHEMA',
                  `Câu hỏi trắc nghiệm số ${q.question_number} chứa phương án có key rỗng.`
                );
              }
              if (seenKeys.has(optKey)) {
                return createErrorResponse(
                  422,
                  'ERR_INVALID_OPTION_SCHEMA',
                  `Câu hỏi trắc nghiệm số ${q.question_number} có key trùng lặp: '${optKey}'.`
                );
              }
              seenKeys.add(optKey);

              const optText = typeof opt.text === 'string' ? opt.text.trim() : '';
              if (!optText) {
                return createErrorResponse(
                  422,
                  'ERR_INVALID_OPTION_SCHEMA',
                  `Câu hỏi trắc nghiệm số ${q.question_number} chứa phương án '${optKey}' có nội dung rỗng.`
                );
              }
            }
          }
        }
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

    // =========================================================================
    // =========================================================================
    // ENDPOINT 7: GET /list-exam-attempts
    // =========================================================================
    if (req.method === 'GET' && (action === 'list-exam-attempts' || action === 'list-attempts' || action === 'attempts')) {
      const examId = url.searchParams.get('exam_id');
      const versionId = url.searchParams.get('version_id');
      const classId = url.searchParams.get('class_id');

      const valResult = validateListExamAttemptsParams({
        exam_id: examId,
        version_id: versionId,
        class_id: classId,
      });

      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(
          400,
          valResult.errorCode || 'INVALID_INPUT',
          valResult.errorMessage || 'Tham số yêu cầu không hợp lệ.'
        );
      }

      const params = valResult.data;

      // 1. Resolve target exam_version_ids
      let versionIds: string[] = [];

      if (params.version_id) {
        const { data: vRow, error: vErr } = await examClient
          .from('exam_versions')
          .select('id, exam_id')
          .eq('id', params.version_id)
          .maybeSingle();

        if (vErr || !vRow) {
          return createErrorResponse(404, 'ERR_VERSION_NOT_FOUND', 'Không tìm thấy phiên bản đề thi.');
        }
        versionIds = [vRow.id];
      } else if (params.exam_id) {
        const { data: eRow, error: eErr } = await examClient
          .from('exam_tests')
          .select('id')
          .eq('id', params.exam_id)
          .maybeSingle();

        if (eErr || !eRow) {
          return createErrorResponse(404, 'ERR_EXAM_NOT_FOUND', 'Không tìm thấy đề thi.');
        }

        const { data: vRows } = await examClient
          .from('exam_versions')
          .select('id')
          .eq('exam_id', params.exam_id);
        versionIds = (vRows || []).map((v: any) => v.id);
      }

      if (versionIds.length === 0) {
        return createSuccessResponse({ attempts: [] });
      }

      // 2. Fetch assignments for these versions
      let assignQuery = examClient
        .from('exam_assignments')
        .select('id, exam_version_id, class_id, due_date, assigned_at')
        .in('exam_version_id', versionIds);

      if (params.class_id) {
        assignQuery = assignQuery.eq('class_id', params.class_id);
      }

      const { data: assignments, error: assignErr } = await assignQuery;
      if (assignErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tải thông tin phân công bài thi.');
      }

      if (!assignments || assignments.length === 0) {
        return createSuccessResponse({ attempts: [] });
      }

      // 3. Authorization check and scope narrowing for Teacher (PURE CLASS-OWNERSHIP RULE)
      let scopedAssignments = assignments;
      if (actorRole === 'teacher') {
        // If teacher requested a specific class_id, verify caller is the teacher of that class
        if (params.class_id) {
          const { data: requestedClass, error: reqClassErr } = await coreClient
            .from('classes')
            .select('id, teacher_id')
            .eq('id', params.class_id)
            .maybeSingle();

          if (reqClassErr) {
            return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi kiểm tra quyền hạn lớp học.');
          }

          if (!requestedClass || requestedClass.teacher_id !== callerId) {
            return createErrorResponse(
              403,
              'CLASS_ACCESS_DENIED',
              'Bạn không có quyền xem kết quả của lớp học này.'
            );
          }
        }

        // Narrow assignments strictly to classes managed by this teacher
        const authorizedAssignments: any[] = [];
        for (const a of assignments) {
          const { data: cRow } = await coreClient
            .from('classes')
            .select('id, teacher_id')
            .eq('id', a.class_id)
            .maybeSingle();
          if (cRow && cRow.teacher_id === callerId) {
            authorizedAssignments.push(a);
          }
        }
        scopedAssignments = authorizedAssignments;
      }

      if (scopedAssignments.length === 0) {
        return createSuccessResponse({ attempts: [] });
      }

      const assignmentIds = scopedAssignments.map((a: any) => a.id);
      const assignmentMap = new Map<string, any>();
      scopedAssignments.forEach((a: any) => assignmentMap.set(a.id, a));

      // 4. Fetch attempts for these assignments
      const { data: attempts, error: attErr } = await examClient
        .from('exam_attempts')
        .select(`
          id,
          assignment_id,
          exam_version_id,
          student_id,
          attempt_number,
          status,
          attempt_started_at,
          expires_at,
          submitted_at,
          objective_score,
          manual_score,
          total_score,
          max_score,
          reward_stars_awarded,
          graded_at,
          graded_by,
          teacher_feedback,
          version
        `)
        .in('assignment_id', assignmentIds)
        .order('submitted_at', { ascending: false, nullsFirst: false });

      if (attErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tải danh sách bài làm của học sinh.');
      }

      if (!attempts || attempts.length === 0) {
        return createSuccessResponse({ attempts: [] });
      }

      // 5. Enrich with CORE profiles and classes
      const studentIds = Array.from(new Set(attempts.map((att: any) => att.student_id)));
      const classIds = Array.from(new Set(assignments.map((a: any) => a.class_id)));

      const studentsMap = new Map<string, any>();
      if (studentIds.length > 0) {
        try {
          const { data: profs } = await coreClient
            .from('profiles')
            .select('id, full_name, role')
            .in?.('id', studentIds as string[]) || { data: null };
          (profs || []).forEach((p: any) => studentsMap.set(p.id, p));
        } catch (_) {}
      }

      const classesMap = new Map<string, any>();
      for (const cId of classIds) {
        try {
          const { data: cRow } = await coreClient
            .from('classes')
            .select('id, name, grade_level, teacher_id')
            .eq('id', cId)
            .maybeSingle();
          if (cRow) classesMap.set(cId, cRow);
        } catch (_) {}
      }

      // 6. Map and sanitize response
      const mappedAttempts = attempts.map((att: any) => {
        const assign = assignmentMap.get(att.assignment_id);
        const student = studentsMap.get(att.student_id);
        const classInfo = assign ? classesMap.get(assign.class_id) : null;

        return {
          id: att.id,
          assignment_id: att.assignment_id,
          exam_version_id: att.exam_version_id,
          student_id: att.student_id,
          student_name: student?.full_name || 'Học sinh',
          class_id: assign?.class_id || null,
          class_name: classInfo?.name || 'Lớp học',
          attempt_number: att.attempt_number,
          started_at: att.attempt_started_at,
          submitted_at: att.submitted_at,
          status: att.status,
          objective_score: att.objective_score,
          manual_score: att.manual_score,
          total_score: att.total_score,
          max_score: att.max_score,
          reward_stars_awarded: att.reward_stars_awarded,
          graded_at: att.graded_at,
          graded_by: att.graded_by,
          teacher_feedback: att.teacher_feedback,
          version: att.version,
        };
      });

      return createSuccessResponse({ attempts: mappedAttempts });
    }

    // =========================================================================
    // ENDPOINT 8: GET /get-attempt-detail
    // =========================================================================
    if (req.method === 'GET' && action === 'get-attempt-detail') {
      const attemptId = url.searchParams.get('attempt_id');
      const valResult = validateGetAttemptDetailParams({ attempt_id: attemptId });

      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(
          400,
          valResult.errorCode || 'INVALID_INPUT',
          valResult.errorMessage || 'Mã attempt_id không hợp lệ.'
        );
      }

      // 1. Fetch target attempt
      const { data: attemptRow, error: attErr } = await examClient
        .from('exam_attempts')
        .select(`
          id,
          assignment_id,
          exam_version_id,
          student_id,
          attempt_number,
          status,
          attempt_started_at,
          expires_at,
          submitted_at,
          objective_score,
          manual_score,
          total_score,
          max_score,
          question_order,
          reward_stars_awarded,
          graded_at,
          graded_by,
          teacher_feedback,
          version
        `)
        .eq('id', valResult.data.attempt_id)
        .maybeSingle();

      if (attErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi truy vấn thông tin lượt thi.');
      }

      if (!attemptRow) {
        return createErrorResponse(404, 'ERR_ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài thi.');
      }

      // 2. Resolve assignment & class
      const { data: assignRow, error: assignErr } = await examClient
        .from('exam_assignments')
        .select('id, exam_version_id, class_id')
        .eq('id', attemptRow.assignment_id)
        .maybeSingle();

      if (assignErr || !assignRow) {
        return createErrorResponse(404, 'ERR_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài giao của lượt thi.');
      }

      // 3. Authorization check for Teacher (PURE CLASS-OWNERSHIP RULE: Must be teacher of the assigned class)
      if (actorRole === 'teacher') {
        const { data: classRow, error: classErr } = await coreClient
          .from('classes')
          .select('id, teacher_id')
          .eq('id', assignRow.class_id)
          .maybeSingle();

        if (classErr) {
          return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi kiểm tra quyền hạn lớp học.');
        }

        if (!classRow || classRow.teacher_id !== callerId) {
          return createErrorResponse(
            403,
            'CLASS_ACCESS_DENIED',
            'Bạn không có quyền xem chi tiết bài làm của lớp học này.'
          );
        }
      }

      // 5. Fetch questions for this version (SAFE: ZERO ANSWER KEYS EXPOSED)
      const { data: questions, error: qErr } = await examClient
        .from('exam_questions')
        .select('id, question_number, question_type, prompt, points, options_json')
        .eq('exam_version_id', attemptRow.exam_version_id);

      if (qErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tải danh sách câu hỏi.');
      }

      // 6. Fetch student answers from exam_attempt_answers
      const { data: answers, error: aErr } = await examClient
        .from('exam_attempt_answers')
        .select('exam_question_id, student_answer_json, file_url, points_earned, is_correct, grading_status, teacher_comment')
        .eq('attempt_id', attemptRow.id);

      if (aErr) {
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tải câu trả lời của học sinh.');
      }

      const answersMap = new Map<string, any>();
      (answers || []).forEach((ans: any) => answersMap.set(ans.exam_question_id, ans));

      const questionsMap = new Map<string, any>();
      (questions || []).forEach((q: any) => questionsMap.set(q.id, q));

      // 7. Order questions according to attempt.question_order snapshot
      let orderedQIds: string[] = [];
      if (Array.isArray(attemptRow.question_order)) {
        orderedQIds = attemptRow.question_order;
      } else {
        orderedQIds = (questions || [])
          .sort((a: any, b: any) => a.question_number - b.question_number)
          .map((q: any) => q.id);
      }

      const enrichedQuestions = orderedQIds
        .map((qId: string, idx: number) => {
          const q = questionsMap.get(qId);
          if (!q) return null;
          const ans = answersMap.get(qId);
          const isManual = ['essay', 'image_upload', 'file_upload'].includes(q.question_type);

          return {
            exam_question_id: q.id,
            question_number: idx + 1,
            original_question_number: q.question_number,
            question_type: q.question_type,
            is_manual: isManual,
            prompt: q.prompt,
            points_possible: q.points,
            options_json: q.options_json || [],
            student_answer: ans?.student_answer_json ?? null,
            file_url: ans?.file_url ?? null,
            points_earned: ans?.points_earned ?? null,
            is_correct: ans?.is_correct ?? null,
            grading_status: ans?.grading_status || (isManual ? 'pending_manual' : 'pending_auto'),
            teacher_comment: ans?.teacher_comment ?? null,
          };
        })
        .filter(Boolean);

      // 8. Fetch student profile and class details from CORE
      let studentName = 'Học sinh';
      try {
        const { data: prof } = await coreClient
          .from('profiles')
          .select('id, full_name')
          .eq('id', attemptRow.student_id)
          .maybeSingle();
        if (prof?.full_name) studentName = prof.full_name;
      } catch (_) {}

      let className = 'Lớp học';
      try {
        const { data: cRow } = await coreClient
          .from('classes')
          .select('id, name')
          .eq('id', assignRow.class_id)
          .maybeSingle();
        if (cRow?.name) className = cRow.name;
      } catch (_) {}

      return createSuccessResponse({
        attempt: {
          id: attemptRow.id,
          assignment_id: attemptRow.assignment_id,
          exam_version_id: attemptRow.exam_version_id,
          student_id: attemptRow.student_id,
          student_name: studentName,
          class_id: assignRow.class_id,
          class_name: className,
          attempt_number: attemptRow.attempt_number,
          started_at: attemptRow.attempt_started_at,
          expires_at: attemptRow.expires_at,
          submitted_at: attemptRow.submitted_at,
          status: attemptRow.status,
          objective_score: attemptRow.objective_score,
          manual_score: attemptRow.manual_score,
          total_score: attemptRow.total_score,
          max_score: attemptRow.max_score,
          reward_stars_awarded: attemptRow.reward_stars_awarded,
          graded_at: attemptRow.graded_at,
          graded_by: attemptRow.graded_by,
          teacher_feedback: attemptRow.teacher_feedback,
          version: attemptRow.version,
        },
        questions: enrichedQuestions,
      });
    }

    // =========================================================================
    // ENDPOINT 9: POST /import-question-bank-items (SERVER-SIDE SNAPSHOT PERSISTENCE)
    // =========================================================================
    if (req.method === 'POST' && (action === 'import-question-bank-items' || action === 'import-qb-questions')) {
      let rawBody: unknown;
      try {
        rawBody = await req.json();
      } catch (_) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.');
      }

      const valResult = validateImportQuestionBankPayload(rawBody);
      if (!valResult.valid || !valResult.data) {
        return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Dữ liệu không hợp lệ.');
      }

      const { version_id: versionId, exam_id: examId, question_bank_item_ids: qbItemIds } = valResult.data;

      // 1. Phân quyền: Chỉ Giáo viên hoặc Quản trị viên
      if (actorRole !== 'admin' && actorRole !== 'teacher') {
        return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền nhập câu hỏi.');
      }

      // 2. Kiểm tra phiên bản đề thi đích (BẮT BUỘC tồn tại và ở trạng thái nháp 'draft')
      const { data: vRow, error: vErr } = await examClient
        .from('exam_versions')
        .select(`
          id,
          exam_id,
          version_number,
          status,
          title,
          subject,
          grade_level,
          description,
          duration_minutes,
          starts_at,
          last_start_at,
          due_date,
          max_attempts,
          reward_stars,
          shuffle_questions,
          shuffle_options,
          tab_switch_policy,
          show_score_after_submit,
          show_correct_answers
        `)
        .eq('id', versionId)
        .maybeSingle();

      if (vErr || !vRow) {
        return createErrorResponse(404, 'ERR_VERSION_NOT_FOUND', 'Không tìm thấy phiên bản đề thi.');
      }

      if (vRow.status !== 'draft') {
        return createErrorResponse(403, 'ERR_VERSION_IMMUTABLE', 'Chỉ có thể nhập câu hỏi vào phiên bản đề thi đang ở trạng thái nháp (draft).');
      }

      const { data: tRow, error: tErr } = await examClient
        .from('exam_tests')
        .select('id, author_id, title, subject, grade_level')
        .eq('id', vRow.exam_id)
        .maybeSingle();

      if (tErr) {
        console.error('[exam-management-api] exam_tests lookup failed', {
          code: (tErr as any).code,
          message: (tErr as any).message,
        });

        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Lỗi khi kiểm tra thông tin đề thi.'
        );
      }

      if (!tRow) {
        return createErrorResponse(
          404,
          'ERR_EXAM_NOT_FOUND',
          'Không tìm thấy đề thi.'
        );
      }

      if (actorRole === 'teacher' && tRow.author_id !== callerId) {
        return createErrorResponse(403, 'FORBIDDEN', 'Bạn không có quyền chỉnh sửa đề thi của giáo viên khác.');
      }

      // 3. Re-query từng Question Bank Item từ database bằng examClient (Service Role)
      const { data: qbItems, error: qbErr } = await examClient
        .from('question_bank_items')
        .select(`
          id,
          code,
          title,
          question_type,
          subject,
          grade_level,
          difficulty,
          status,
          visibility,
          school_id,
          author_id,
          current_version_id,
          version_count,
          tags
        `)
        .in('id', qbItemIds);

      if (qbErr) {
        console.error('[exam-management-api] question_bank_items lookup failed', {
          code: (qbErr as any).code,
          message: (qbErr as any).message,
        });
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tra cứu ngân hàng câu hỏi.');
      }

      const itemsList = qbItems || [];
      const itemMap = new Map(itemsList.map((i: any) => [i.id, i]));

      // Yêu cầu tập hợp câu hỏi tìm thấy phải khớp chính xác 100% với danh sách yêu cầu (Tuyệt đối KHÔNG import một phần)
      if (itemsList.length !== qbItemIds.length) {
        return createErrorResponse(
          404,
          'ERR_QB_ITEM_NOT_FOUND',
          `Một hoặc nhiều câu hỏi được chọn không tồn tại trong ngân hàng câu hỏi (Tìm thấy ${itemsList.length}/${qbItemIds.length}).`
        );
      }

      for (const reqId of qbItemIds) {
        if (!itemMap.has(reqId)) {
          return createErrorResponse(
            404,
            'ERR_QB_ITEM_NOT_FOUND',
            `Không tìm thấy câu hỏi có ID '${reqId}' trong ngân hàng câu hỏi.`
          );
        }
      }

      // 4. Lấy danh sách version_id
      const versionIds = itemsList.map((i: any) => i.current_version_id).filter(Boolean);
      if (versionIds.length !== itemsList.length) {
        return createErrorResponse(404, 'ERR_QB_VERSION_NOT_FOUND', 'Một hoặc nhiều câu hỏi chưa có phiên bản nội dung hợp lệ.');
      }

      const { data: versionsData, error: verErr } = await examClient
        .from('question_bank_versions')
        .select(`
          id,
          question_bank_item_id,
          version_number,
          prompt,
          options,
          media_urls,
          hints,
          explanation
        `)
        .in('id', versionIds);

      if (verErr) {
        console.error('[exam-management-api] question_bank_versions lookup failed', {
          code: (verErr as any).code,
          message: (verErr as any).message,
        });
        return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi khi tải chi tiết phiên bản câu hỏi.');
      }

      const versionsMap = new Map((versionsData || []).map((v: any) => [v.id, v]));

      // 5. Lấy đáp án bảo mật từ Server-Only RPC rpc_qb_get_answer_key_server_only
      const keysMap = new Map<string, any>();
      for (const item of itemsList) {
        if (!item.current_version_id) continue;
        const rpcKeyRes = await examClient.rpc('rpc_qb_get_answer_key_server_only', {
          p_caller_id: callerId,
          p_actor_role: 'admin', // Context server backend
          p_item_id: item.id,
          p_version_id: item.current_version_id,
        });

        if (rpcKeyRes.data && rpcKeyRes.data.success && rpcKeyRes.data.has_answer_key) {
          keysMap.set(item.current_version_id, rpcKeyRes.data.answer_key);
        }
      }

      // 6. Kiểm tra quyền truy cập và chuyển đổi Canonical Schema với kiểm tra fail-closed nghiêm ngặt
      const validatedQuestions: Array<{
        id: string;
        question_type: string;
        prompt: string;
        options_json: Array<{ key: string; text: string }>;
        answer_key: {
          correct_answer: any;
          accepted_answers?: string[];
          case_sensitive?: boolean;
          grading_config?: any;
        } | null;
        source_question_bank_item_id: string;
        source_question_bank_version_id: string;
      }> = [];

      for (let i = 0; i < qbItemIds.length; i++) {
        const itemId = qbItemIds[i];
        const item = itemMap.get(itemId);
        if (!item) {
          return createErrorResponse(404, 'ERR_QB_ITEM_NOT_FOUND', `Không tìm thấy câu hỏi có ID '${itemId}'.`);
        }

        // Phân quyền trên từng câu hỏi:
        // Teacher: Được dùng câu của chính mình HOẶC câu đã published có visibility = public_template
        if (actorRole === 'teacher') {
          const isOwn = item.author_id === callerId;
          const isPublishedShared = item.status === 'published' && item.visibility === 'public_template';
          if (!isOwn && !isPublishedShared) {
            return createErrorResponse(403, 'FORBIDDEN_QUESTION_ACCESS', `Bạn không có quyền sử dụng câu hỏi '${item.title || item.id}'.`);
          }
        }

        const ver = versionsMap.get(item.current_version_id);
        if (!ver) {
          return createErrorResponse(404, 'ERR_QB_VERSION_NOT_FOUND', `Không tìm thấy phiên bản câu hỏi cho '${item.title || item.id}'.`);
        }

        const ansKey = keysMap.get(ver.id) || null;
        const qType = item.question_type || 'single_choice';
        const prompt = String(ver.prompt || item.title || '').trim();

        if (!prompt) {
          return createErrorResponse(400, 'ERR_QB_PROMPT_EMPTY', `Câu hỏi '${item.title || item.id}' có nội dung đề bài rỗng.`);
        }

        // Validate options cho câu hỏi trắc nghiệm
        let canonicalOptions: Array<{ key: string; text: string; originalId?: string }> = [];
        if (['single_choice', 'multiple_choice'].includes(qType)) {
          const rawOpts = ver.options;
          if (!Array.isArray(rawOpts) || rawOpts.length < 2) {
            return createErrorResponse(400, 'ERR_QB_OPTIONS_INVALID', `Câu hỏi '${item.title || item.id}' phải có ít nhất 2 phương án lựa chọn hợp lệ.`);
          }

          const seenTexts = new Set<string>();
          const seenIds = new Set<string>();

          for (let oi = 0; oi < rawOpts.length; oi++) {
            const opt = rawOpts[oi];
            const key = String.fromCharCode(65 + oi);
            let text = '';
            let originalId = `opt_${oi + 1}`;

            if (typeof opt === 'string') {
              text = opt.trim();
            } else if (opt && typeof opt === 'object') {
              text = typeof opt.text === 'string' ? opt.text.trim() : String(opt.text ?? '').trim();
              if (opt.id) originalId = String(opt.id).trim();
              else if (opt.key) originalId = String(opt.key).trim();
            } else {
              return createErrorResponse(400, 'ERR_QB_OPTIONS_INVALID', `Phương án thứ ${oi + 1} của câu hỏi '${item.title || item.id}' không hợp lệ.`);
            }

            if (!text) {
              return createErrorResponse(400, 'ERR_QB_OPTIONS_INVALID', `Phương án ${key} của câu hỏi '${item.title || item.id}' có nội dung rỗng.`);
            }

            const lower = text.toLowerCase();
            if (seenTexts.has(lower)) {
              return createErrorResponse(400, 'ERR_QB_OPTIONS_INVALID', `Câu hỏi '${item.title || item.id}' có phương án lựa chọn bị trùng lặp: "${text}".`);
            }
            seenTexts.add(lower);

            if (originalId) {
              const idLower = originalId.toLowerCase();
              if (seenIds.has(idLower)) {
                return createErrorResponse(400, 'ERR_QB_OPTIONS_INVALID', `Câu hỏi '${item.title || item.id}' có mã phương án bị trùng lặp: "${originalId}".`);
              }
              seenIds.add(idLower);
            }

            canonicalOptions.push({ key, text, originalId });
          }
        }

        // Validate answer key cho auto-gradable types
        let canonicalAnswerKey: any = null;

        if (qType === 'single_choice') {
          if (!ansKey || !ansKey.correct_answers) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Câu hỏi trắc nghiệm '${item.title || item.id}' thiếu đáp án đúng trong ngân hàng câu hỏi.`);
          }
          const correctObj = ansKey.correct_answers;
          const rawTarget = correctObj.correct_option_id ?? correctObj.correct_answer ?? correctObj.correct_option;
          if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === '') {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Câu hỏi trắc nghiệm '${item.title || item.id}' thiếu cấu hình đáp án đúng.`);
          }

          const targetStr = String(rawTarget).trim();
          let matchedKey: string | null = null;

          const matchByOrig = canonicalOptions.find(o => o.originalId && o.originalId.toLowerCase() === targetStr.toLowerCase());
          if (matchByOrig) {
            matchedKey = matchByOrig.key;
          } else {
            const matchByKey = canonicalOptions.find(o => o.key.toUpperCase() === targetStr.toUpperCase());
            if (matchByKey) {
              matchedKey = matchByKey.key;
            } else {
              const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === targetStr.toLowerCase());
              if (matchByText) matchedKey = matchByText.key;
              else {
                const num = parseInt(targetStr, 10);
                if (!isNaN(num) && num >= 1 && num <= canonicalOptions.length) {
                  matchedKey = canonicalOptions[num - 1].key;
                }
              }
            }
          }

          if (!matchedKey) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Đáp án đúng "${targetStr}" không khớp với bất kỳ phương án lựa chọn nào của câu hỏi '${item.title || item.id}'.`);
          }

          canonicalAnswerKey = { correct_answer: matchedKey };
        } else if (qType === 'multiple_choice') {
          if (!ansKey || !ansKey.correct_answers) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Câu hỏi trắc nghiệm '${item.title || item.id}' thiếu đáp án đúng trong ngân hàng câu hỏi.`);
          }
          const correctObj = ansKey.correct_answers;
          const rawList = correctObj.correct_option_ids ?? correctObj.correct_answers ?? correctObj.correct_answer;
          let targets: string[] = [];
          if (Array.isArray(rawList)) {
            targets = rawList.map(s => String(s).trim()).filter(Boolean);
          } else if (typeof rawList === 'string' && rawList.trim()) {
            targets = rawList.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
          }

          if (targets.length === 0) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Câu hỏi trắc nghiệm nhiều đáp án '${item.title || item.id}' thiếu danh sách đáp án đúng.`);
          }

          const matchedKeys: string[] = [];
          for (const target of targets) {
            const matchByOrig = canonicalOptions.find(o => o.originalId && o.originalId.toLowerCase() === target.toLowerCase());
            if (matchByOrig && !matchedKeys.includes(matchByOrig.key)) {
              matchedKeys.push(matchByOrig.key);
              continue;
            }
            const matchByKey = canonicalOptions.find(o => o.key.toUpperCase() === target.toUpperCase());
            if (matchByKey && !matchedKeys.includes(matchByKey.key)) {
              matchedKeys.push(matchByKey.key);
              continue;
            }
            const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === target.toLowerCase());
            if (matchByText && !matchedKeys.includes(matchByText.key)) {
              matchedKeys.push(matchByText.key);
              continue;
            }

            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Đáp án đúng "${target}" không khớp với bất kỳ phương án nào của câu hỏi '${item.title || item.id}'.`);
          }

          if (matchedKeys.length === 0) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Không tìm thấy đáp án đúng hợp lệ cho câu hỏi '${item.title || item.id}'.`);
          }

          canonicalAnswerKey = { correct_answer: matchedKeys.sort() };
        } else if (['fill_blank', 'short_answer'].includes(qType)) {
          if (!ansKey || !ansKey.correct_answers) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Câu hỏi '${item.title || item.id}' thiếu đáp án đúng.`);
          }
          const correctObj = ansKey.correct_answers;
          const rawCorrect = correctObj.correct_text !== undefined ? correctObj.correct_text : (correctObj.correct_answer || '');
          const correctStr = String(rawCorrect || '').trim();

          if (!correctStr) {
            return createErrorResponse(400, 'ERR_QB_ANSWER_KEY_INVALID', `Câu hỏi '${item.title || item.id}' có nội dung đáp án đúng rỗng.`);
          }

          const accepted = Array.isArray(correctObj.accepted_texts)
            ? correctObj.accepted_texts.map(String)
            : (Array.isArray(correctObj.accepted_answers) ? correctObj.accepted_answers.map(String) : []);

          canonicalAnswerKey = {
            correct_answer: correctStr,
            accepted_answers: accepted.map(s => s.trim()).filter(Boolean),
          };
        } else {
          // Manual question types (essay, image_upload, file_upload)
          canonicalAnswerKey = null;
        }

        validatedQuestions.push({
          id: generateUuid(),
          question_type: qType,
          prompt,
          options_json: canonicalOptions.map(o => ({ key: o.key, text: o.text })),
          answer_key: canonicalAnswerKey,
          source_question_bank_item_id: item.id,
          source_question_bank_version_id: ver.id,
        });
      }

      // 7. Lấy danh sách câu hỏi hiện tại trong draft qua RPC an toàn
      const existingRes = await examClient.rpc('rpc_exam_get_draft_questions_with_answers', {
        p_caller_id: callerId,
        p_version_id: versionId,
        p_is_admin: actorRole === 'admin',
      });

      if (existingRes.error) {
        const norm = normalizeRpcError(existingRes.error);
        return createErrorResponse(norm.status, norm.errorCode, norm.message);
      }

      const existingQuestions: any[] = existingRes.data?.questions || [];
      const baseIndex = existingQuestions.length;

      // 8. Kết hợp câu hỏi cũ và câu hỏi mới thành danh sách hoàn chỉnh
      const safeProjectedQuestions: any[] = [];
      const newQuestionsForSave: any[] = [];

      for (let i = 0; i < validatedQuestions.length; i++) {
        const q = validatedQuestions[i];
        const qNum = baseIndex + i + 1;

        newQuestionsForSave.push({
          id: q.id,
          question_number: qNum,
          question_type: q.question_type,
          prompt: q.prompt,
          points: 1.0,
          options_json: q.options_json,
          answer_key: q.answer_key,
          source_question_bank_item_id: q.source_question_bank_item_id,
          source_question_bank_version_id: q.source_question_bank_version_id,
        });

        // Safe projection (KHÔNG chứa answer_key)
        safeProjectedQuestions.push({
          id: q.id,
          exam_version_id: versionId,
          question_number: qNum,
          question_type: q.question_type,
          prompt: q.prompt,
          points: 1.0,
          options_json: q.options_json,
          source_question_bank_item_id: q.source_question_bank_item_id,
          source_question_bank_version_id: q.source_question_bank_version_id,
        });
      }

      const combinedQuestions = [...existingQuestions, ...newQuestionsForSave];

      // 9. Thực hiện lưu Snapshot nguyên tử (Atomic Server-Side Persistence) bằng rpc_exam_save_draft_version
      const saveRes = await examClient.rpc('rpc_exam_save_draft_version', {
        p_caller_id: callerId,
        p_version_id: versionId,
        p_title: vRow.title || tRow.title,
        p_subject: vRow.subject || tRow.subject,
        p_grade_level: vRow.grade_level || tRow.grade_level,
        p_description: vRow.description || tRow.description,
        p_duration_minutes: vRow.duration_minutes,
        p_starts_at: vRow.starts_at,
        p_last_start_at: vRow.last_start_at,
        p_due_date: vRow.due_date,
        p_max_attempts: vRow.max_attempts || 1,
        p_reward_stars: vRow.reward_stars || 0,
        p_shuffle_questions: vRow.shuffle_questions,
        p_shuffle_options: vRow.shuffle_options,
        p_tab_switch_policy: vRow.tab_switch_policy,
        p_show_score_after_submit: vRow.show_score_after_submit,
        p_show_correct_answers: vRow.show_correct_answers,
        p_questions: combinedQuestions,
        p_is_admin: actorRole === 'admin',
      });

      if (saveRes.error) {
        const norm = normalizeRpcError(saveRes.error);
        return createErrorResponse(norm.status, norm.errorCode, norm.message);
      }

      // 10. Phản hồi hoàn tất với Safe Projection (ZERO ANSWER KEY LEAK)
      return createSuccessResponse({
        total_imported: safeProjectedQuestions.length,
        imported_questions: safeProjectedQuestions,
      }, 200);
    }

    // Nếu không khớp action nào
    return createErrorResponse(404, 'ENDPOINT_NOT_FOUND', `Không tìm thấy endpoint: ${action}`);
  } catch (err: any) {
    return createErrorResponse(500, 'INTERNAL_ERROR', err?.message || 'Đã xảy ra lỗi không xác định.');
  }
}
