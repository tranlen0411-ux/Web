// supabase/functions/exam-management-api/authMiddleware.ts
// Multi-Database Authentication & Role Scoping Middleware for Exam Builder Management BFF

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createErrorResponse } from './errors.ts';

export type ActorRole = 'admin' | 'teacher' | 'student';

export interface ManagementTrustedContext {
  callerId: string;
  actorRole: 'admin' | 'teacher';
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
          data: { id: string; role: string; full_name?: string; is_disabled?: boolean } | null;
          error: unknown;
        }>;
      };
      in?(col: string, vals: string[]): Promise<{
        data: Array<{ id: string; full_name: string; email?: string }> | null;
        error: unknown;
      }>;
    };
  };
  from(table: 'classes'): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { id: string; teacher_id: string; name?: string; grade_level?: number } | null;
          error: unknown;
        }>;
      };
    };
  };
}

export interface ExamQueryClient {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
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

export interface ManagementAuthResult {
  ok: boolean;
  context?: ManagementTrustedContext;
  response?: Response;
  coreClient?: CoreQueryClient;
  examClient?: ExamQueryClient;
}

export async function verifyManagementAuthAndDeriveContext(
  req: Request,
  deps?: AuthDependencies
): Promise<ManagementAuthResult> {
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
        if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
          return Deno.env.get(key);
        }
      } catch (_) {
        return undefined;
      }
      return undefined;
    };

    const coreUrl =
      getEnv('SUPABASE_CORE_URL') ||
      getEnv('CORE_SUPABASE_URL') ||
      getEnv('SUPABASE_URL');
    const coreAnonKey =
      getEnv('SUPABASE_CORE_ANON_KEY') ||
      getEnv('CORE_SUPABASE_ANON_KEY') ||
      getEnv('SUPABASE_ANON_KEY');
    const coreServiceKey =
      getEnv('SUPABASE_CORE_SERVICE_ROLE_KEY') ||
      getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY');

    const examUrl =
      getEnv('EXAM_SUPABASE_URL') ||
      getEnv('SUPABASE_URL') ||
      'https://szptvqkoiphrhlionfoh.supabase.co';
    const examServiceKey =
      getEnv('EXAM_SUPABASE_SERVICE_ROLE_KEY') ||
      getEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!coreUrl || !coreAnonKey) {
      return {
        ok: false,
        response: createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Thiếu cấu hình kết nối dự án CORE.'
        ),
      };
    }

    if (!examUrl || !examServiceKey) {
      return {
        ok: false,
        response: createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Thiếu cấu hình kết nối dự án NEW (Service Role).'
        ),
      };
    }

    // Client 1: Dùng Bearer token người dùng gửi lên để xác thực qua CORE Auth
    callerClient = createClient(coreUrl, coreAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }) as unknown as CallerAuthClient;

    // Client 2: Dùng Service Role trên CORE để đọc phân quyền profile & classes an toàn
    coreClient = createClient(coreUrl, coreServiceKey || coreAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }) as unknown as CoreQueryClient;

    // Client 3: Dùng Service Role trên NEW để thực thi RPCs và thao tác bảng exam
    examClient = createClient(examUrl, examServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }) as unknown as ExamQueryClient;
  }

  // 1. Xác thực danh tính với Core Auth
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
      ),
    };
  }

  const callerId = userData.user.id;

  // 2. Tra cứu vai trò và trạng thái tài khoản từ CORE profiles
  const { data: profileRow, error: profileError } = await coreClient
    .from('profiles')
    .select('id, role, is_disabled')
    .eq('id', callerId)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      response: createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Lỗi kiểm tra thông tin tài khoản người dùng.'
      ),
    };
  }

  if (!profileRow) {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'USER_NOT_FOUND',
        'Không tìm thấy hồ sơ người dùng trong hệ thống.'
      ),
    };
  }

  if (profileRow.is_disabled === true) {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'ACCOUNT_DISABLED',
        'Tài khoản của bạn đã bị vô hiệu hóa.'
      ),
    };
  }

  const actorRole = profileRow.role as ActorRole;

  if (actorRole !== 'admin' && actorRole !== 'teacher') {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Chỉ Giáo viên hoặc Quản trị viên mới có quyền truy cập khu vực quản lý đề thi.'
      ),
    };
  }

  return {
    ok: true,
    context: {
      callerId,
      actorRole,
    },
    coreClient,
    examClient,
  };
}
