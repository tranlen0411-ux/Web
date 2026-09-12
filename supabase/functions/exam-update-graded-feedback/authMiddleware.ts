// supabase/functions/exam-update-graded-feedback/authMiddleware.ts
// Secure Auth & Permission Middleware for Exam Graded Feedback Update BFF

import { createErrorResponse } from './errors.ts';

let createClientFn: any = null;
async function resolveCreateClient() {
  if (createClientFn) return createClientFn;
  try {
    // @ts-ignore
    if (typeof Deno !== 'undefined') {
      // @ts-ignore
      const mod = await import('https://esm.sh/@supabase/supabase-js@2');
      createClientFn = mod.createClient;
      return createClientFn;
    }
  } catch (_) {}
  try {
    // @ts-ignore
    const mod = await import('@supabase/supabase-js');
    createClientFn = mod.createClient;
    return createClientFn;
  } catch (_) {}
  return null;
}


export type ActorRole = 'admin' | 'teacher' | 'student';

export interface TrustedContext {
  callerId: string;
  actorRole: ActorRole;
}

export interface CallerAuthClient {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null } | null;
      error: unknown;
    }>;
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
  from(table: 'classes'): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { id: string; teacher_id: string } | null;
          error: unknown;
        }>;
      };
    };
  };
}

export interface ExamQueryClient {
  from(table: 'exam_attempts'): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { id: string; assignment_id: string } | null;
          error: unknown;
        }>;
      };
    };
  };
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
  rpc(
    name: 'rpc_exam_update_graded_feedback',
    args: {
      p_caller_id: string;
      p_attempt_id: string;
      p_teacher_feedback: string | null;
      p_question_comments: unknown[];
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

export interface AuthResult {
  ok: boolean;
  context?: TrustedContext;
  response?: Response;
  coreClient?: CoreQueryClient;
  examClient?: ExamQueryClient;
}

export async function verifyAuthAndDeriveContext(
  req: Request,
  deps?: AuthDependencies
): Promise<AuthResult> {
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
    const getEnv = (key: string): string | undefined => {
      try {
        if (deps && 'env' in deps && deps.env && typeof deps.env[key] === 'string') {
          return deps.env[key];
        }
        // @ts-ignore Deno env access
        if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
          // @ts-ignore Deno env access
          return Deno.env.get(key);
        }
      } catch (_) {
        // Fallback
      }
      return undefined;
    };

    const coreUrl = getEnv('CORE_SUPABASE_URL');
    const coreAnonKey = getEnv('CORE_SUPABASE_ANON_KEY');
    const coreServiceKey = getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY');

    // NEW Exam URL resolution order:
    // 1. EXAM_SUPABASE_URL
    // 2. NEW_SUPABASE_URL
    // 3. SUPABASE_URL (Hosted Edge runtime default on host project)
    const examUrl =
      getEnv('EXAM_SUPABASE_URL') ||
      getEnv('NEW_SUPABASE_URL') ||
      getEnv('SUPABASE_URL');

    // NEW Exam Service Role Key resolution order:
    // 1. EXAM_SUPABASE_SERVICE_ROLE_KEY
    // 2. NEW_SUPABASE_SERVICE_ROLE_KEY
    // 3. SUPABASE_SERVICE_ROLE_KEY
    // 4. SUPABASE_SECRET_KEYS['default']
    let examServiceKey =
      getEnv('EXAM_SUPABASE_SERVICE_ROLE_KEY') ||
      getEnv('NEW_SUPABASE_SERVICE_ROLE_KEY') ||
      getEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!examServiceKey) {
      const rawSecretKeys = getEnv('SUPABASE_SECRET_KEYS');
      if (rawSecretKeys) {
        try {
          const parsed = JSON.parse(rawSecretKeys);
          if (
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            typeof parsed.default === 'string' &&
            parsed.default.trim() !== ''
          ) {
            examServiceKey = parsed.default.trim();
          }
        } catch (_) {
          // Fail-closed: Malformed JSON -> examServiceKey remains undefined
        }
      }
    }

    // Fail-Closed: Thiếu cấu hình môi trường bắt buộc -> 500 INTERNAL_ERROR
    if (!coreUrl || !coreAnonKey || !coreServiceKey || !examUrl || !examServiceKey) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', 'Cấu hình máy chủ bị thiếu.'),
      };
    }

    const createClient = await resolveCreateClient();
    if (!createClient) {
      return {
        ok: false,
        response: createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Không thể khởi tạo Supabase Client.'
        ),
      };
    }

    // 1. Client 1: Xác thực JWT danh tính Caller bằng CORE Anon Key trên CORE URL
    const coreCallerClient = createClient(coreUrl, coreAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 2. Client 2: Đọc CORE Database (profiles, classes) bằng CORE Service Role Key trên CORE URL
    const coreAdminClient = createClient(coreUrl, coreServiceKey, {
      auth: { persistSession: false },
    });

    // 3. Client 3: Thao tác NEW Database (exam_attempts, assignments, RPC) bằng EXAM Service Role Key trên EXAM URL
    const examAdminClient = createClient(examUrl, examServiceKey, {
      auth: { persistSession: false },
    });

    callerClient = coreCallerClient;
    coreClient = coreAdminClient as unknown as CoreQueryClient;
    examClient = examAdminClient as unknown as ExamQueryClient;
  }



  // 1. Xác thực JWT với CORE Auth
  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData || !userData.user || !userData.user.id) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'INVALID_TOKEN',
        'Token xác thực không hợp lệ hoặc đã hết hạn.'
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

  if (profile.role !== 'admin' && profile.role !== 'teacher') {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Chỉ Giáo viên hoặc Quản trị viên mới có quyền cập nhật nhận xét bài thi.'
      ),
    };
  }

  const trustedContext: TrustedContext = {
    callerId,
    actorRole: profile.role as ActorRole,
  };

  return {
    ok: true,
    context: trustedContext,
    coreClient,
    examClient,
  };
}
