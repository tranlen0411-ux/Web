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
  | 'rpc_qb_update_item_metadata'
  | 'rpc_qb_list_versions'
  | 'rpc_qb_safe_delete_or_archive_question';

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
  backendConfig?: BackendProjectConfig;
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
  backendConfig?: BackendProjectConfig;
}

export interface BackendProjectConfig {
  mode: 'two-project' | 'single-project';
  coreUrl: string;
  coreAnonKey: string;
  coreServiceKey: string;
  qbUrl: string;
  qbServiceKey: string;
}

export interface ConfigResolutionResult {
  ok: boolean;
  config?: BackendProjectConfig;
  error?: string;
}

export const APPROVED_STAGING_HOSTNAME = 'rcqgxmcqolxbrahhyxji.supabase.co';

function validateProjectUrl(
  rawUrl: string,
  varName: string,
  options?: { requireHttps?: boolean; allowedHostname?: string }
): { ok: boolean; url?: string; hostname?: string; error?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (options?.requireHttps) {
      if (parsed.protocol !== 'https:') {
        return { ok: false, error: `${varName}: Giao thức không an toàn. Bắt buộc sử dụng HTTPS.` };
      }
    } else {
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, error: `${varName}: Giao thức không an toàn.` };
      }
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: `${varName}: Chứa thông tin đăng nhập trong URL.` };
    }
    if (parsed.search || parsed.hash) {
      return { ok: false, error: `${varName}: Chứa query hoặc hash fragment.` };
    }
    if (options?.allowedHostname && parsed.hostname !== options.allowedHostname) {
      return {
        ok: false,
        error: `${varName}: Hostname "${parsed.hostname}" không được phép trong chế độ Single-Project. Chỉ chấp nhận ${options.allowedHostname}.`,
      };
    }
    return { ok: true, url: parsed.origin, hostname: parsed.hostname };
  } catch (_) {
    return { ok: false, error: `${varName}: URL không đúng định dạng.` };
  }
}

/**
 * Phân giải cấu hình kết nối backend an toàn cho Question Bank Edge Function:
 * 1. Chế độ Two-Project (Production): Khi có BẤT KỲ biến nào trong 5 biến CORE_* hoặc QUESTION_BANK_*,
 *    bắt buộc có đủ cả 5 biến môi trường định danh. Không fallback sang biến khác.
 * 2. Chế độ Single-Project (Staging): Khi KHÔNG có bất kỳ biến Two-Project nào, đọc 3 biến môi trường
 *    chuẩn do nền tảng Supabase tự động cung cấp (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
 *    BẮT BUỘC SUPABASE_URL phải trỏ chính xác về Staging rcqgxmcqolxbrahhyxji.supabase.co qua giao thức HTTPS.
 * 3. Nếu thiếu biến, sai định dạng, hoặc trỏ sang project khác (Production Core, Exam Builder): Fail-Closed và từ chối khởi tạo.
 */
export function resolveBackendProjectConfig(
  getEnv: (key: string) => string | undefined
): ConfigResolutionResult {
  const coreUrl = getEnv('CORE_SUPABASE_URL')?.trim();
  const coreAnonKey = getEnv('CORE_SUPABASE_ANON_KEY')?.trim();
  const coreServiceKey = getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const qbUrl = getEnv('QUESTION_BANK_SUPABASE_URL')?.trim();
  const qbServiceKey = getEnv('QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY')?.trim();

  const hasAnyTwoProjectVar = Boolean(
    coreUrl || coreAnonKey || coreServiceKey || qbUrl || qbServiceKey
  );

  // Mode 1: Explicit Two-Project Mode (Production)
  if (hasAnyTwoProjectVar) {
    if (!coreUrl || !coreAnonKey || !coreServiceKey || !qbUrl || !qbServiceKey) {
      return {
        ok: false,
        error: 'Cấu hình Two-Project không đầy đủ. Bắt buộc đủ cả 5 biến môi trường CORE và QUESTION_BANK.',
      };
    }
    const validatedCore = validateProjectUrl(coreUrl, 'CORE_SUPABASE_URL', { requireHttps: true });
    if (!validatedCore.ok) return { ok: false, error: validatedCore.error };
    const validatedQb = validateProjectUrl(qbUrl, 'QUESTION_BANK_SUPABASE_URL', { requireHttps: true });
    if (!validatedQb.ok) return { ok: false, error: validatedQb.error };

    return {
      ok: true,
      config: {
        mode: 'two-project',
        coreUrl: validatedCore.url!,
        coreAnonKey,
        coreServiceKey,
        qbUrl: validatedQb.url!,
        qbServiceKey,
      },
    };
  }

  // Mode 2: Single-Project Unified Mode (Staging) - BẮT BUỘC Staging Identity Pinning
  const platformUrl = getEnv('SUPABASE_URL')?.trim();
  const platformAnonKey = getEnv('SUPABASE_ANON_KEY')?.trim();
  const platformServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();

  if (platformUrl && platformAnonKey && platformServiceKey) {
    const validatedPlatform = validateProjectUrl(platformUrl, 'SUPABASE_URL', {
      requireHttps: true,
      allowedHostname: APPROVED_STAGING_HOSTNAME,
    });
    if (!validatedPlatform.ok) return { ok: false, error: validatedPlatform.error };

    return {
      ok: true,
      config: {
        mode: 'single-project',
        coreUrl: validatedPlatform.url!,
        coreAnonKey: platformAnonKey,
        coreServiceKey: platformServiceKey,
        qbUrl: validatedPlatform.url!,
        qbServiceKey: platformServiceKey,
      },
    };
  }

  // Neither mode is satisfied -> Fail-Closed
  return {
    ok: false,
    error: 'Cấu hình máy chủ bị thiếu. Không tìm thấy cấu hình Two-Project hoặc Single-Project hợp lệ.',
  };
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
  let resolvedBackendConfig: BackendProjectConfig | undefined;

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
    resolvedBackendConfig = deps.backendConfig;
  } else {
    // Production / Staging Server Mode
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

    const configResult = resolveBackendProjectConfig(getEnv);
    if (!configResult.ok || !configResult.config) {
      return {
        ok: false,
        response: createErrorResponse(
          500,
          'INTERNAL_ERROR',
          configResult.error || 'Cấu hình máy chủ bị thiếu.'
        ),
      };
    }

    resolvedBackendConfig = configResult.config;
    const { coreUrl, coreAnonKey, coreServiceKey, qbUrl, qbServiceKey } = configResult.config;

    // 1. Client 1: coreCallerClient - Xác thực JWT danh tính Caller bằng CORE Anon Key trên CORE URL
    const coreCallerClient = createClient(coreUrl, coreAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // 2. Client 2: coreProfileClient - Đọc bảng profiles bằng CORE Service Role Key trên CORE URL
    const coreProfileClient = createClient(coreUrl, coreServiceKey, {
      auth: { persistSession: false },
    });

    // 3. Client 3: questionBankRpcClient - Gọi các RPC QB bằng QB Service Role Key trên QB URL
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
    backendConfig: resolvedBackendConfig,
  };
}
