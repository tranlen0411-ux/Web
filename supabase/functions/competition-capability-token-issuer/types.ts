// supabase/functions/competition-capability-token-issuer/types.ts

export type RequestMode = 'guest' | 'auth';

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'session_unavailable'
  | 'rate_limited'
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

/**
 * Provisional Rate Limiter interface hook point.
 * Implementation Status: DEFERRED / PROVISIONAL (Model resolved as PARTIAL).
 * Not treated as an authoritative security boundary.
 */
export interface RateLimiter {
  check(identifier: string): Promise<{ allowed: boolean; retryAfter?: number }>;
}
