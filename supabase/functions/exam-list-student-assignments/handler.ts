// supabase/functions/exam-list-student-assignments/handler.ts
// Exam Builder Student List Assignments Handler V1 (Phase A Flexible Scheduling Contract)
// Pure Dispatch Module - Zero Side Effects, Anti-Leak Projection, Multi-Class Ownership Resolution

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
} from '../_shared/examErrors.ts';
import {
  AuthDependencies,
  CoreQueryClient,
  ExamQueryClient,
  InjectedAuthDependencies,
  verifyStudentAuthAndDeriveContext,
} from '../_shared/examAuth.ts';
import { validateListStudentAssignmentsPayload } from './validation.ts';

export interface ExtendedExamQueryClient extends ExamQueryClient {
  from(table: string): any;
}

export interface ExtendedCoreQueryClient extends CoreQueryClient {
  from(table: string): any;
}

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  coreClient?: ExtendedCoreQueryClient;
  examClient?: ExtendedExamQueryClient;
}

export interface StudentExamAssignmentListItem {
  id: string;
  exam_version_id: string;
  title: string;
  description: string | null;
  subject: string;
  grade_level: number;
  assigned_at: string;
  opens_at: string | null;
  last_start_at: string | null;
  closes_at: string | null;
  duration_minutes: number | null;
  total_points: number;
  reward_stars: number;
  attempt_status: string | null;
  attempt_id: string | null;
  attempt_started_at: string | null;
  attempt_expires_at: string | null;
  latest_score: number | null;
  max_score: number | null;
}

export async function handleListStudentAssignmentsRequest(
  req: Request,
  deps?: HandlerDependencies
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 2. Chỉ cho phép method GET hoặc POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return createErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Phương thức HTTP không được hỗ trợ.'
    );
  }

  let currentStage: string = 'AUTH';

  try {
    // 3. Phân tích Auth Header & Xác thực Token CORE JWT
    console.log('LIST_STAGE_START=AUTH');
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const authContext = await verifyStudentAuthAndDeriveContext(authHeader, deps?.authDeps);

    if (!authContext.success || !authContext.studentContext) {
      console.error('LIST_AUTH_ERROR=' + (authContext.errorCode || 'UNAUTHORIZED'));
      return createErrorResponse(
        authContext.httpStatus || 401,
        authContext.errorCode || 'UNAUTHORIZED',
        authContext.errorMessage || 'Xác thực tài khoản học sinh không thành công.'
      );
    }
    console.log('LIST_STAGE_PASS=AUTH');

    const callerId = authContext.studentContext.studentId;

    // 4. Nếu là POST, kiểm tra body để ngăn chặn tham số cấm/tiêm nhiễm đặc quyền
    if (req.method === 'POST') {
      currentStage = 'VALIDATION';
      console.log('LIST_STAGE_START=VALIDATION');
      let body: unknown = undefined;
      try {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = JSON.parse(text);
        }
      } catch (_jsonErr) {
        return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu JSON không hợp lệ.');
      }

      const validation = validateListStudentAssignmentsPayload(body, { callerId });
      if (!validation.valid) {
        console.error('LIST_VALIDATION_ERROR=' + (validation.errorCode || 'INVALID_INPUT'));
        return createErrorResponse(
          400,
          validation.errorCode || 'INVALID_INPUT',
          validation.errorMessage || 'Tham số yêu cầu không hợp lệ.'
        );
      }
      console.log('LIST_STAGE_PASS=VALIDATION');
    }

    // 5. Khởi tạo Query Clients cho 2 cơ sở dữ liệu
    const coreClient = deps?.coreClient;
    const examClient = deps?.examClient;

    if (!coreClient || !examClient) {
      console.error('LIST_CONFIG_ERROR=CLIENT_INIT');
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kết nối cơ sở dữ liệu máy chủ.');
    }

    // 6. Bước 1 (CORE Read-only): Truy vấn danh sách lớp học sinh đang là thành viên
    currentStage = 'MEMBERSHIP';
    console.log('LIST_STAGE_START=MEMBERSHIP');
    const { data: memberRows, error: memberErr } = await coreClient
      .from('class_members')
      .select('class_id')
      .eq('student_id', callerId);

    if (memberErr) {
      console.error('LIST_QUERY_ERROR=MEMBERSHIP');
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin lớp học của học sinh.');
    }
    console.log('LIST_STAGE_PASS=MEMBERSHIP');

    const classIds: string[] = Array.from(
      new Set((memberRows || []).map((m: any) => m.class_id).filter(Boolean))
    );

    // 7. Nếu học sinh chưa thuộc lớp nào, trả về danh sách rỗng an toàn
    if (classIds.length === 0) {
      return createSuccessResponse({ assignments: [] }, 200);
    }

    // 8. Bước 2 (NEW Read-only): Đọc các bài giao thuộc các lớp của học sinh từ public.exam_assignments
    currentStage = 'ASSIGNMENTS';
    console.log('LIST_STAGE_START=ASSIGNMENTS');
    const { data: assignmentRows, error: assignErr } = await examClient
      .from('exam_assignments')
      .select('id, exam_version_id, class_id, assigned_at, starts_at, last_start_at, due_date, created_at')
      .in('class_id', classIds)
      .order('assigned_at', { ascending: false })
      .order('id', { ascending: false });

    if (assignErr) {
      console.error('LIST_QUERY_ERROR=ASSIGNMENTS');
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn danh sách bài thi được giao.');
    }
    console.log('LIST_STAGE_PASS=ASSIGNMENTS');

    if (!assignmentRows || assignmentRows.length === 0) {
      return createSuccessResponse({ assignments: [] }, 200);
    }

    // 9. Bước 3 (NEW Read-only): Đọc thông tin đề thi snapshot từ public.exam_versions
    const versionIds: string[] = Array.from(
      new Set(assignmentRows.map((a: any) => a.exam_version_id).filter(Boolean))
    );

    currentStage = 'VERSIONS';
    console.log('LIST_STAGE_START=VERSIONS');
    const { data: versionRows, error: verErr } = await examClient
      .from('exam_versions')
      .select('id, title, description, subject, grade_level, duration_minutes, starts_at, last_start_at, due_date, total_points, reward_stars, status')
      .in('id', versionIds)
      .in('status', ['published', 'superseded']);

    if (verErr) {
      console.error('LIST_QUERY_ERROR=VERSIONS');
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin phiên bản đề thi.');
    }
    console.log('LIST_STAGE_PASS=VERSIONS');

    const versionMap = new Map<string, any>(
      (versionRows || []).map((v: any) => [v.id, v])
    );

    // 10. Bước 4 (NEW Read-only): Đọc trạng thái lượt làm bài của học sinh từ public.exam_attempts
    const assignmentIds: string[] = assignmentRows.map((a: any) => a.id).filter(Boolean);

    currentStage = 'ATTEMPTS';
    console.log('LIST_STAGE_START=ATTEMPTS');
    const { data: attemptRows, error: attErr } = await examClient
      .from('exam_attempts')
      .select('id, assignment_id, status, attempt_number, attempt_started_at, expires_at, total_score, max_score, created_at')
      .eq('student_id', callerId)
      .in('assignment_id', assignmentIds)
      .order('attempt_number', { ascending: false });

    if (attErr) {
      console.error('LIST_QUERY_ERROR=ATTEMPTS');
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin kết quả làm bài của học sinh.');
    }
    console.log('LIST_STAGE_PASS=ATTEMPTS');

    // Map lượt làm bài mới nhất (attempt_number cao nhất) cho mỗi assignment_id
    const latestAttemptMap = new Map<string, any>();
    for (const att of attemptRows || []) {
      if (!latestAttemptMap.has(att.assignment_id)) {
        latestAttemptMap.set(att.assignment_id, att);
      }
    }

    // 11. Bước 5: Chiếu dữ liệu an toàn tuyệt đối (Strict Response Allowlist)
    currentStage = 'ASSEMBLY';
    console.log('LIST_STAGE_START=ASSEMBLY');
    const resultAssignments: StudentExamAssignmentListItem[] = [];

    for (const asg of assignmentRows) {
      const ver = versionMap.get(asg.exam_version_id);
      // Nếu phiên bản đề thi không tồn tại hoặc ở trạng thái draft/archived -> ẩn khỏi học sinh
      if (!ver) continue;

      const latestAttempt = latestAttemptMap.get(asg.id) || null;

      // 1. Effective Opens At (Giờ mở đề sớm nhất)
      const effectiveOpensAt: string | null = asg.starts_at ?? ver.starts_at ?? null;

      // 2. Effective Last Start At (Hạn chót vào thi - Bảo toàn fallback due_date cũ)
      const effectiveLastStartAt: string | null =
        asg.last_start_at ??
        ver.last_start_at ??
        asg.due_date ??
        ver.due_date ??
        null;

      // 3. Effective Hard Close (Trần đóng cứng: sớm nhất trong hạn của bài giao và hạn của phiên bản)
      let closesAt: string | null = null;
      if (asg.due_date && ver.due_date) {
        closesAt = new Date(asg.due_date) < new Date(ver.due_date) ? asg.due_date : ver.due_date;
      } else {
        closesAt = asg.due_date ?? ver.due_date ?? null;
      }

      resultAssignments.push({
        id: asg.id,
        exam_version_id: ver.id,
        title: ver.title,
        description: ver.description || null,
        subject: ver.subject,
        grade_level:
          typeof ver.grade_level === 'number' &&
          Number.isInteger(ver.grade_level) &&
          ver.grade_level >= 1 &&
          ver.grade_level <= 12
            ? ver.grade_level
            : 1,
        assigned_at: asg.assigned_at,
        opens_at: effectiveOpensAt,
        last_start_at: effectiveLastStartAt,
        closes_at: closesAt,
        duration_minutes:
          typeof ver.duration_minutes === 'number' &&
          Number.isInteger(ver.duration_minutes) &&
          ver.duration_minutes > 0
            ? ver.duration_minutes
            : null,
        total_points:
          typeof ver.total_points === 'number' &&
          Number.isFinite(ver.total_points) &&
          ver.total_points >= 0
            ? ver.total_points
            : Number(ver.total_points || 0),
        reward_stars:
          typeof ver.reward_stars === 'number' &&
          Number.isInteger(ver.reward_stars) &&
          ver.reward_stars >= 0
            ? ver.reward_stars
            : Math.max(0, Math.floor(Number(ver.reward_stars || 0))),
        attempt_status: latestAttempt ? latestAttempt.status : null,
        attempt_id: latestAttempt ? latestAttempt.id : null,
        attempt_started_at: latestAttempt ? latestAttempt.attempt_started_at || null : null,
        attempt_expires_at: latestAttempt ? latestAttempt.expires_at || null : null,
        latest_score:
          latestAttempt &&
          latestAttempt.status === 'graded' &&
          typeof latestAttempt.total_score === 'number' &&
          Number.isFinite(latestAttempt.total_score) &&
          latestAttempt.total_score >= 0
            ? latestAttempt.total_score
            : null,
        max_score:
          latestAttempt &&
          typeof latestAttempt.max_score === 'number' &&
          Number.isFinite(latestAttempt.max_score) &&
          latestAttempt.max_score > 0
            ? latestAttempt.max_score
            : (latestAttempt
                ? typeof ver.total_points === 'number' && ver.total_points > 0
                  ? ver.total_points
                  : 10
                : null),
      });
    }
    console.log('LIST_STAGE_PASS=ASSEMBLY');

    // 12. Trả về envelope thành công
    return createSuccessResponse({ assignments: resultAssignments }, 200);
  } catch (err: unknown) {
    const rawName =
      err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string'
        ? (err as { name: string }).name
        : 'UNKNOWN';

    const safeExceptionName =
      ['TypeError', 'Error', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError'].includes(rawName)
        ? rawName
        : 'UNKNOWN';

    console.error(
      'LIST_FATAL_STAGE=' + currentStage,
      'TYPE=' + safeExceptionName
    );

    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Lỗi máy chủ nội bộ.'
    );
  }
}
