// supabase/functions/competition-capability-token-issuer/types.ts

export type RequestMode = 'guest' | 'auth';

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'session_unavailable'
  | 'rate_limited'
  | 'rate_limit_unavailable'
  | 'internal_error';

export interface GuestRequestBody {
  session_id: string;
  participant_id: string;
  guest_token: string;
}

export interface AuthRequestBody {
  session_id: string;
  participant_id: string;
}

export type ValidatedRequestBody =
  | { mode: 'guest'; data: GuestRequestBody }
  | { mode: 'auth'; data: AuthRequestBody; bearerToken: string };

export interface CapabilityJwtClaims {
  role: 'competition_guest';
  session_id: string;
  participant_id: string;
  iat: number;
  exp: number;
}

export interface CapabilityTokenResponse {
  token: string;
  expires_at: number;
  expires_in: 300;
}

export interface StandardErrorEnvelope {
  error: ErrorCode;
  message: string;
  request_id: string;
}

export interface AdminCredential {
  type: 'secret_key' | 'service_role';
  key: string;
}

export interface RpcVerificationRow {
  is_valid: boolean;
  error_code: string | null;
  participant_status: string | null;
  session_status: string | null;
}

export interface RpcVerificationResult {
  success: boolean;
  row?: RpcVerificationRow;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  reset?: number;
}

export type LimitedDimension = 'user' | 'participant' | 'session';

export interface CapabilityRateLimitResult {
  allowed: boolean;
  limitedDimension?: LimitedDimension;
  retryAfter?: number;
}

export interface RateLimiterService {
  checkParticipant(sessionId: string, participantId: string, requestId?: string): Promise<RateLimitCheckResult>;
  checkAuthUser(userId: string, requestId?: string): Promise<RateLimitCheckResult>;
  checkSession(sessionId: string, requestId?: string): Promise<RateLimitCheckResult>;
}

export interface CapabilityRateLimiterService {
  checkGuest(
    sessionId: string,
    participantId: string,
    requestId?: string
  ): Promise<CapabilityRateLimitResult>;

  checkAuth(
    userId: string,
    sessionId: string,
    participantId: string,
    requestId?: string
  ): Promise<CapabilityRateLimitResult>;
}
