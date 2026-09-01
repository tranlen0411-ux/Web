// supabase/functions/question-bank-api/authMiddleware.ts
// Two-Client Authentication & Trusted Context Derivation Middleware

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
}

export type AuthDependencies =
  | { mode?: 'production' }
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
      response: createErrorResponse(401, 'UNAUTHORIZED', 'Bearer token không hợp lệ.'),
    };
  }

  let callerClient: CallerAuthClient;
  let profileClient: ProfileQueryClient;
  let rpcClient: RpcClient | undefined;

  if (deps?.mode === 'injected') {
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
  } else {
    // Production Mode: Đọc Deno.env và khởi tạo Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', 'Cấu hình máy chủ bị thiếu.'),
      };
    }

    // 1. Client 1: Xác thực JWT danh tính Caller bằng Anon Key
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 2. Client 2: Client đặc quyền Server-Side đọc Profile và gọi RPC từ CORE
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    callerClient = supabaseCaller;
    profileClient = supabaseAdmin as unknown as ProfileQueryClient;
    rpcClient = supabaseAdmin as unknown as RpcClient;
  }

  // Xác thực JWT
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

  // Đọc Profile từ CORE
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

  const trustedContext: TrustedContext = {
    callerId: profile.id,
    actorRole: profile.role as ActorRole,
    schoolId: null, // Hardcoded null in V1
  };

  return {
    ok: true,
    context: trustedContext,
    adminClient: rpcClient,
  };
}
