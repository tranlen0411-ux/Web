// supabase/functions/question-bank-api/authMiddleware.ts
// Two-Project Architecture: Three-Client Authentication & Trusted Context Derivation Middleware

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createErrorResponse } from './errors.ts';

export type ActorRole = 'admin' | 'teacher' | 'student';

export interface TrustedContext {
  callerId: string;
  actorRole: ActorRole;
  schoolId: null;
}

export type UserFacingQuestionBankRpc =
  | 'rpc_qb_create_question'
  | 'rpc_qb_create_version'
  | 'rpc_qb_get_student_question'
  | 'rpc_qb_get_authoring_detail'
  | 'rpc_qb_list_questions'
  | 'rpc_qb_fork_question'
  | 'rpc_qb_update_item_metadata';

export interface CallerAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export interface ProfileQueryClient {
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
}

export interface RpcClient {
  rpc(
    name: UserFacingQuestionBankRpc,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface InjectedAuthDependencies {
  mode: 'injected';
  callerAuthClient: CallerAuthClient;
  profileQueryClient: ProfileQueryClient;
  rpcClient?: RpcClient;
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
  adminClient?: RpcClient;
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
        'UNAUTHORIZED',
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
        'UNAUTHORIZED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  let callerClient: CallerAuthClient;
  let profileClient: ProfileQueryClient;
  let rpcClient: RpcClient | undefined;

  if (deps && 'mode' in deps && deps.mode === 'injected') {
    // Injected Mock Mode: TUYỆT ĐỐI không fallback sang Deno.env hay createClient
    if (!deps.callerAuthClient || !deps.profileQueryClient) {
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
    profileClient = deps.profileQueryClient;
    rpcClient = deps.rpcClient;
  } else {
    // Production Mode: Đọc đúng 5 biến môi trường cho mô hình Two-Project Auth
    const getEnv = (key: string): string | undefined => {
      try {
        if (deps && 'env' in deps && deps.env && typeof deps.env[key] === 'string') {
          return deps.env[key];
        }
        return Deno.env.get(key);
      } catch (_) {
        return undefined;
      }
    };

    const coreUrl = getEnv('CORE_SUPABASE_URL');
    const coreAnonKey = getEnv('CORE_SUPABASE_ANON_KEY');
    const coreServiceKey = getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY');
    const qbUrl = getEnv('QUESTION_BANK_SUPABASE_URL');
    const qbServiceKey = getEnv('QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY');

    // Fail-Closed: Thiếu bất kỳ biến nào trong 5 biến -> 500 INTERNAL_ERROR
    if (!coreUrl || !coreAnonKey || !coreServiceKey || !qbUrl || !qbServiceKey) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', 'Cấu hình máy chủ bị thiếu.'),
      };
    }

    // 1. Client 1: coreCallerClient - Xác thực JWT danh tính Caller bằng CORE Anon Key trên CORE URL
    const coreCallerClient = createClient(coreUrl, coreAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 2. Client 2: coreProfileClient - Đọc bảng profiles bằng CORE Service Role Key trên CORE URL
    const coreProfileClient = createClient(coreUrl, coreServiceKey, {
      auth: { persistSession: false },
    });

    // 3. Client 3: questionBankRpcClient - Gọi 7 RPC QB bằng QB Service Role Key trên QB URL
    const questionBankRpcClient = createClient(qbUrl, qbServiceKey, {
      auth: { persistSession: false },
    });

    callerClient = coreCallerClient;
    profileClient = coreProfileClient as unknown as ProfileQueryClient;
    rpcClient = questionBankRpcClient as unknown as RpcClient;
  }

  // 1. Xác thực JWT thông qua CORE Auth API (BẮT BUỘC LÀ NGUỒN DUY NHẤT CỦA CALLER ID)
  const { data: userData, error: authError } = await callerClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'UNAUTHORIZED',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
      ),
    };
  }

  const callerId = userData.user.id;

  // 2. Đọc Profile và phân quyền từ CORE Database
  const { data: profile, error: dbError } = await profileClient
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
        'FORBIDDEN',
        'Hồ sơ người dùng không tồn tại trong hệ thống.'
      ),
    };
  }

  // Khẳng định tính nhất quán bất biến giữa JWT user.id và profile.id
  if (profile.id !== callerId) {
    return {
      ok: false,
      response: createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Lỗi kiểm tra hồ sơ người dùng.'
      ),
    };
  }

  if (profile.is_disabled === true) {
    return {
      ok: false,
      response: createErrorResponse(403, 'FORBIDDEN', 'Tài khoản của bạn đã bị vô hiệu hóa.'),
    };
  }

  if (
    profile.role !== 'admin' &&
    profile.role !== 'teacher' &&
    profile.role !== 'student'
  ) {
    return {
      ok: false,
      response: createErrorResponse(403, 'FORBIDDEN', 'Vai trò người dùng không hợp lệ.'),
    };
  }

  // 3. Thiết lập Trusted Context hoàn toàn từ Server: callerId BẮT BUỘC lấy trực tiếp từ JWT user.id
  const trustedContext: TrustedContext = {
    callerId,
    actorRole: profile.role as ActorRole,
    schoolId: null, // Hardcoded null in V1
  };

  return {
    ok: true,
    context: trustedContext,
    adminClient: rpcClient,
  };
}
