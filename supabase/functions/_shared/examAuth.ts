// supabase/functions/_shared/examAuth.ts
// Two-Project Architecture: Student Authentication & Trusted Context Derivation Middleware

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createErrorResponse } from './examErrors.ts';
import { resolveRuntimeConfig } from './examRuntime.ts';

export interface StudentTrustedContext {
  callerId: string;
  actorRole: 'student';
}

export interface CallerAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export interface CoreQueryClient {
  from(table: 'profiles'): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { id: string; role: string; is_disabled?: boolean } | null;
          error: unknown;
        }>;
      };
    };
  };
  from(table: 'class_members'): {
    select(cols: string): {
      eq(col1: string, val1: string): {
        eq(col2: string, val2: string): {
          maybeSingle(): Promise<{
            data: { class_id: string; student_id: string } | null;
            error: unknown;
          }>;
        };
      };
    };
  };
}

export interface ExamQueryClient {
  from(table: 'exam_assignments'): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { id: string; class_id: string } | null;
          error: unknown;
        }>;
      };
    };
  };
  from(table: 'exam_attempts'): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { id: string; assignment_id: string; student_id: string; status: string; version: number } | null;
          error: unknown;
        }>;
      };
    };
  };
  rpc(
    name: 'rpc_exam_start_attempt',
    args: {
      p_caller_id: string;
      p_attempt_id: string;
      p_assignment_id: string;
      p_student_id: string;
    }
  ): Promise<{ data: unknown; error: unknown }>;
  rpc(
    name: 'rpc_exam_save_answer',
    args: {
      p_caller_id: string;
      p_attempt_id: string;
      p_exam_question_id: string;
      p_student_answer_json: unknown;
      p_file_url: string | null;
      p_expected_version: number;
    }
  ): Promise<{ data: unknown; error: unknown }>;
  rpc(
    name: 'rpc_exam_submit_attempt',
    args: {
      p_caller_id: string;
      p_attempt_id: string;
      p_expected_version: number;
    }
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface InjectedAuthDependencies {
  mode: 'injected';
  callerAuthClient: CallerAuthClient;
  coreQueryClient: CoreQueryClient;
  examQueryClient?: ExamQueryClient;
}

export interface ProductionAuthDependencies {
  mode?: 'production';
  env?: Record<string, string>;
}

export type AuthDependencies =
  | ProductionAuthDependencies
  | InjectedAuthDependencies;

export interface StudentAuthResult {
  ok: boolean;
  context?: StudentTrustedContext;
  response?: Response;
  coreClient?: CoreQueryClient;
  examClient?: ExamQueryClient;
}

export async function verifyStudentAuthAndDeriveContext(
  req: Request,
  deps?: AuthDependencies
): Promise<StudentAuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  let callerClient: CallerAuthClient;
  let coreClient: CoreQueryClient;
  let examClient: ExamQueryClient | undefined;

  if (deps && 'mode' in deps && deps.mode === 'injected') {
    if (!deps.callerAuthClient || !deps.coreQueryClient) {
      return {
        ok: false,
        response: createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Cấu hình mock dependencies không đầy đủ.'
        ),
      };
    }
    callerClient = deps.callerAuthClient;
    coreClient = deps.coreQueryClient;
    examClient = deps.examQueryClient;
  } else {
    const envGetter = (key: string): string | undefined => {
      if (deps && 'env' in deps && deps.env && typeof deps.env[key] === 'string') {
        return deps.env[key];
      }
      return undefined;
    };

    const cfg = resolveRuntimeConfig(envGetter);
    if (!cfg) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', 'Cấu hình máy chủ bị thiếu.'),
      };
    }

    // 1. Client 1: Xác thực JWT danh tính Caller bằng CORE Anon Key trên CORE URL
    const coreCallerClient = createClient(cfg.coreUrl, cfg.coreAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 2. Client 2: Đọc CORE Database (profiles, class_members) bằng CORE Service Role Key trên CORE URL
    const coreAdminClient = createClient(cfg.coreUrl, cfg.coreServiceKey, {
      auth: { persistSession: false },
    });

    // 3. Client 3: Thao tác NEW Database bằng EXAM Service Role Key trên EXAM URL
    const examAdminClient = createClient(cfg.examUrl, cfg.examServiceKey, {
      auth: { persistSession: false },
    });

    callerClient = coreCallerClient;
    coreClient = coreAdminClient as unknown as CoreQueryClient;
    examClient = examAdminClient as unknown as ExamQueryClient;
  }

  // 1. Xác thực JWT thông qua CORE Auth API (Nguồn duy nhất của Caller Identity)
  const { data: userData, error: authError } = await callerClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'INVALID_TOKEN',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
      ),
    };
  }

  const callerId = userData.user.id;

  // 2. Đọc Profile và phân quyền vai trò từ CORE Database
  const { data: profile, error: dbError } = await coreClient
    .from('profiles')
    .select('id, role, is_disabled')
    .eq('id', callerId)
    .maybeSingle();

  if (dbError) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (!profile) {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Hồ sơ người dùng không tồn tại trong hệ thống.'
      ),
    };
  }

  if (profile.id !== callerId) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (profile.is_disabled === true) {
    return {
      ok: false,
      response: createErrorResponse(403, 'ACCOUNT_DISABLED', 'Tài khoản của bạn đã bị vô hiệu hóa.'),
    };
  }

  // Phân quyền: CHỈ HỌC SINH (student) mới được phép thực hiện
  if (profile.role !== 'student') {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Chỉ Học sinh mới có quyền thực hiện chức năng làm bài thi.'
      ),
    };
  }

  const trustedContext: StudentTrustedContext = {
    callerId,
    actorRole: 'student',
  };

  return {
    ok: true,
    context: trustedContext,
    coreClient,
    examClient,
  };
}
