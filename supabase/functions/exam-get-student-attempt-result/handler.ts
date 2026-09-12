// supabase/functions/exam-get-student-attempt-result/handler.ts
// Student Exam Attempt Result Read BFF Handler V1 (Phase B2 - Student Result View V1)
// Pure Dispatch Module - Strict Identity Isolation, Graded-Only Release, Anti-Oracle Protection, Zero Answer Key Leak

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
import { validateGetStudentAttemptResultPayload } from './validation.ts';

export interface ExtendedExamQueryClient extends ExamQueryClient {
  from(table: string): any;
}

export interface HandlerDependencies {
  mode?: 'production';
  authDeps?: InjectedAuthDependencies;
  coreClient?: CoreQueryClient;
  examClient?: ExtendedExamQueryClient;
}

export interface StudentAttemptResultQuestionItem {
  exam_question_id: string;
  question_number: number;
  prompt: string;
  question_type: string;
  points_possible: number;
  options_json: Array<{ key: string; text: string }> | null;
  student_answer: unknown;
  file_url: string | null;
  points_earned: number;
  teacher_comment: string | null;
}

export interface StudentAttemptResultResponse {
  attempt: {
    id: string;
    status: string;
    attempt_number: number;
    submitted_at: string | null;
    objective_score: number;
    manual_score: number;
    total_score: number;
    max_score: number;
    teacher_feedback: string | null;
    reward_stars_awarded: number;
  };
  exam: {
    title: string;
    subject: string;
    grade_level: number;
  };
  questions: StudentAttemptResultQuestionItem[];
}

export async function handleGetStudentAttemptResultRequest(
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
    const valResult = validateGetStudentAttemptResultPayload(rawBody, { callerId });
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    // 7. Truy vấn attempt với cả id và student_id (Anti-Oracle Defense-in-depth)
    // Explicit projection - Không dùng SELECT *
    const { data: attemptRow, error: attErr } = await examClient
      .from('exam_attempts')
      .select(`
        id,
        assignment_id,
        exam_version_id,
        student_id,
        attempt_number,
        status,
        submitted_at,
        objective_score,
        manual_score,
        total_score,
        max_score,
        question_order,
        teacher_feedback,
        reward_stars_awarded
      `)
      .eq('id', sanitized.attempt_id)
      .eq('student_id', callerId)
      .maybeSingle();

    if (attErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin kết quả làm bài.');
    }

    if (!attemptRow) {
      // Unified 404: Không phân biệt attempt không tồn tại hay thuộc về học sinh khác
      return createErrorResponse(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài thi.');
    }

    // 8. Result Release Policy: CHỈ TRẢ VỀ KẾT QUẢ CHI TIẾT KHI STATUS === 'graded'
    if (attemptRow.status !== 'graded') {
      return createErrorResponse(
        403,
        'ERR_RESULT_NOT_FINAL',
        'Kết quả bài thi chưa được hoàn tất chấm điểm.'
      );
    }

    // 9. Truy vấn thông tin đề thi snapshot từ public.exam_versions (Explicit projection)
    const { data: versionRow, error: verErr } = await examClient
      .from('exam_versions')
      .select('id, title, subject, grade_level, total_points')
      .eq('id', attemptRow.exam_version_id)
      .maybeSingle();

    if (verErr || !versionRow) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin phiên bản đề thi.');
    }

    // 10. Truy vấn câu hỏi từ public.exam_questions (Explicit projection - 0% Answer Keys)
    const { data: questionRows, error: qErr } = await examClient
      .from('exam_questions')
      .select('id, prompt, question_type, points, options_json')
      .eq('exam_version_id', attemptRow.exam_version_id);

    if (qErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn danh sách câu hỏi bài thi.');
    }

    // 11. Truy vấn câu trả lời của học sinh từ public.exam_attempt_answers (Explicit projection - 0% Private Metadata)
    const { data: answerRows, error: ansErr } = await examClient
      .from('exam_attempt_answers')
      .select('exam_question_id, student_answer_json, file_url, points_earned, teacher_comment')
      .eq('attempt_id', attemptRow.id);

    if (ansErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn câu trả lời của bài làm.');
    }

    const questionMap = new Map<string, any>(
      (questionRows || []).map((q: any) => [q.id, q])
    );
    const answerMap = new Map<string, any>(
      (answerRows || []).map((a: any) => [a.exam_question_id, a])
    );

    // 12. Sắp xếp danh sách câu hỏi theo đúng attempt.question_order
    let orderedQuestionIds: string[] = [];
    if (Array.isArray(attemptRow.question_order) && attemptRow.question_order.length > 0) {
      orderedQuestionIds = attemptRow.question_order.filter(
        (id: any): id is string => typeof id === 'string' && questionMap.has(id)
      );
    } else {
      orderedQuestionIds = (questionRows || []).map((q: any) => q.id);
    }

    const assembledQuestions: StudentAttemptResultQuestionItem[] = [];
    for (let i = 0; i < orderedQuestionIds.length; i++) {
      const qId = orderedQuestionIds[i];
      const q = questionMap.get(qId);
      if (!q) continue;

      const ans = answerMap.get(qId);

      // Safe option mapping (options_json chứa {key, text}, không chứa correct_answer)
      let safeOptions: Array<{ key: string; text: string }> | null = null;
      if (Array.isArray(q.options_json)) {
        safeOptions = q.options_json.map((opt: any) => ({
          key: String(opt.key || ''),
          text: String(opt.text || ''),
        }));
      }

      assembledQuestions.push({
        exam_question_id: q.id,
        question_number: i + 1,
        prompt: q.prompt,
        question_type: q.question_type,
        points_possible: Number(q.points || 0),
        options_json: safeOptions,
        student_answer: ans?.student_answer_json ?? null,
        file_url: ans?.file_url ?? null,
        points_earned:
          ans && ans.points_earned !== null && ans.points_earned !== undefined
            ? Number(ans.points_earned)
            : 0,
        teacher_comment: ans?.teacher_comment || null,
      });
    }

    // 13. Chiếu dữ liệu an toàn trả về cho Student
    const responsePayload: StudentAttemptResultResponse = {
      attempt: {
        id: attemptRow.id,
        status: attemptRow.status,
        attempt_number: attemptRow.attempt_number || 1,
        submitted_at: attemptRow.submitted_at || null,
        objective_score: Number(attemptRow.objective_score || 0),
        manual_score: Number(attemptRow.manual_score || 0),
        total_score: Number(attemptRow.total_score || 0),
        max_score: Number(attemptRow.max_score || versionRow.total_points || 0),
        teacher_feedback: attemptRow.teacher_feedback || null,
        reward_stars_awarded: Number(attemptRow.reward_stars_awarded || 0),
      },
      exam: {
        title: versionRow.title,
        subject: versionRow.subject,
        grade_level: Number(versionRow.grade_level || 1),
      },
      questions: assembledQuestions,
    };

    return createSuccessResponse(responsePayload, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình tải kết quả bài thi.'
    );
  }
}
